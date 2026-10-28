import { NextResponse } from "next/server";

import {
  BOOKING_STATUS_WRITE_ROLES,
  canTransitionBookingStatus,
  bookingStatusLabel,
} from "@/config/lab-bookings";
import {
  authErrorResponse,
  requireRole,
  scopeFilter,
} from "@/lib/auth";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import { toLabBookingDetailDto } from "@/lib/api/serializers";
import { connectToDatabase } from "@/lib/db";
import { appendBookingEvent } from "@/lib/lab-booking/events";
import { LabBooking } from "@/models/LabBooking";
import { Laboratory } from "@/models/Laboratory";
import { LabTest } from "@/models/LabTest";
import {
  generateSlotStarts,
  zonedWallClockToDate,
} from "@/lib/utils/booking-time";
import { toFieldIssues } from "@/lib/validation/common";
import {
  labBookingIdSchema,
  labBookingStatusSchema,
} from "@/lib/validation/lab-booking";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/lab-bookings/[id]/status
 *
 * Operational status changes (approve / complete) for lab managers and
 * administrators. The target status must be a valid forward transition from
 * the stored status (`src/config/lab-bookings.ts`); CANCELLED is only ever
 * reachable through the cancel endpoint and REJECTED only through the
 * dedicated reject endpoint. The update is conditional on the current
 * status, so concurrent conflicting requests produce exactly one winner and
 * the loser receives 409 - a duplicate approval therefore never writes a
 * second record or a second audit event.
 *
 * Approving (PENDING -> CONFIRMED) additionally re-verifies, server-side:
 * the laboratory still exists, is active and still offers the booked slot;
 * every selected test still exists, is active, belongs to that laboratory
 * and still permits a lab visit; and the appointment slot has not already
 * passed. The reviewer id and review timestamp are stamped on the record and
 * an audit event is appended. Bookings are never completed merely because
 * the scheduled date passed - completion is a deliberate staff action.
 *
 * LAB_MANAGER approvals are limited to bookings in their assigned
 * laboratories (out-of-scope bookings answer 404 before any write).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let user: Awaited<ReturnType<typeof requireRole>>;
  try {
    user = await requireRole(...BOOKING_STATUS_WRITE_ROLES);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { id } = await params;
  const parsedId = labBookingIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid booking id.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = labBookingStatusSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const targetStatus = parsed.data.status;

  try {
    await connectToDatabase();

    const booking = await LabBooking.findOne({
      _id: parsedId.data.id,
      ...scopeFilter(user),
    })
      .select("status laboratoryId bookingDate timeSlot timezone items")
      .lean();
    if (!booking) {
      return errorResponse(404, "Booking not found.");
    }

    if (!canTransitionBookingStatus(booking.status, targetStatus)) {
      return errorResponse(
        409,
        `A ${bookingStatusLabel(booking.status).toLowerCase()} booking cannot move to ${bookingStatusLabel(targetStatus).toLowerCase()}.`,
      );
    }

    const update: Record<string, unknown> = { status: targetStatus };

    /* ------------- approval: re-verify the request end to end ------------- */
    if (targetStatus === "CONFIRMED") {
      const laboratory = await Laboratory.findById(booking.laboratoryId)
        .select("name isActive bookingConfig")
        .lean();
      if (!laboratory) {
        return errorResponse(404, "The laboratory for this request was not found.");
      }
      if (!laboratory.isActive) {
        return errorResponse(
          409,
          "This laboratory is no longer accepting bookings, so the request cannot be approved.",
        );
      }

      const scheduleConfig = laboratory.bookingConfig;
      if (!scheduleConfig) {
        return errorResponse(
          409,
          "This laboratory has not configured online booking, so the appointment slot cannot be validated.",
        );
      }

      const validStarts = generateSlotStarts(
        scheduleConfig.openingTime,
        scheduleConfig.closingTime,
        scheduleConfig.slotDurationMinutes,
      );
      if (!validStarts.includes(booking.timeSlot)) {
        return errorResponse(
          409,
          "The requested appointment slot is no longer offered by this laboratory.",
        );
      }

      const startAt = zonedWallClockToDate(
        booking.bookingDate.toISOString().slice(0, 10),
        booking.timeSlot,
        booking.timezone,
      );
      if (!startAt || startAt.getTime() <= Date.now()) {
        return errorResponse(
          409,
          "The appointment slot has already passed. Reject the request instead.",
        );
      }

      const testIds = booking.items.map((item) => item.labTestId);
      const tests = await LabTest.find({ _id: { $in: testIds } })
        .select("laboratoryId name code isActive labVisitEnabled")
        .lean();
      if (tests.length !== testIds.length) {
        return errorResponse(
          409,
          "One or more selected tests no longer exist, so the request cannot be approved.",
        );
      }
      for (const test of tests) {
        if (String(test.laboratoryId) !== String(booking.laboratoryId)) {
          return errorResponse(
            409,
            "A selected test no longer belongs to the booked laboratory.",
          );
        }
        if (!test.isActive) {
          return errorResponse(
            409,
            `${test.name} is no longer offered, so the request cannot be approved.`,
          );
        }
        if (test.labVisitEnabled === false) {
          return errorResponse(
            409,
            `${test.name} is no longer available for a lab visit. Reject the request and ask the patient to re-request.`,
          );
        }
      }

      if (user) {
        update.reviewedBy = user.id;
        update.reviewedAt = new Date();
      }
    }

    // Conditional on the status read above: only one concurrent request wins.
    const updated = await LabBooking.findOneAndUpdate(
      { _id: parsedId.data.id, status: booking.status },
      { $set: update },
      { new: true, runValidators: true },
    )
      .populate("laboratoryId", "name code isActive")
      .populate("patientId", "name")
      .populate("reviewedBy", "name")
      .lean();

    if (!updated) {
      return errorResponse(
        409,
        "The booking status changed before this update could be applied. Refresh and try again.",
      );
    }

    await appendBookingEvent({
      bookingId: String(booking._id),
      eventType:
        targetStatus === "CONFIRMED"
          ? "REQUEST_CONFIRMED"
          : targetStatus === "COMPLETED"
            ? "BOOKING_COMPLETED"
            : "STATUS_CHANGED",
      previousStatus: booking.status,
      newStatus: targetStatus,
      actorId: user.id,
    });

    return itemResponse(toLabBookingDetailDto(updated));
  } catch (error) {
    logApiFailure("lab-bookings/[id]/status", error);
    return errorResponse(
      503,
      "Unable to update the booking status right now. Please try again.",
    );
  }
}
