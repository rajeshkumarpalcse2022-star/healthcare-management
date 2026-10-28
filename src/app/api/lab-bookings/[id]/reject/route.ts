import { NextResponse } from "next/server";

import { BOOKING_STATUS_WRITE_ROLES } from "@/config/lab-bookings";
import {
  authErrorResponse,
  requireRole,
  scopeFilter,
} from "@/lib/auth";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import { toLabBookingDetailDto } from "@/lib/api/serializers";
import { connectToDatabase } from "@/lib/db";
import { appendBookingEvent } from "@/lib/lab-booking/events";
import { releaseSlotQuietly } from "@/lib/lab-booking/slots";
import { LabBooking } from "@/models/LabBooking";
import { toFieldIssues } from "@/lib/validation/common";
import {
  labBookingIdSchema,
  labBookingRejectSchema,
} from "@/lib/validation/lab-booking";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/lab-bookings/[id]/reject
 *
 * Lab-manager review action: rejects a PENDING lab-visit request with a
 * mandatory reason. Rules (all enforced server-side):
 * - only operational review roles may reject;
 * - only a PENDING request may be rejected - once confirmed the workflow has
 *   moved on and cancellation covers the operational case;
 * - the reason is required (schema-level) and stored on the record for the
 *   patient timeline;
 * - the flip is a conditional update so concurrent reviewers produce exactly
 *   one winner; the loser receives 409;
 * - REJECTED is not a capacity-holding status: the reserved slot is released
 *   so the patient may re-request another slot.
 * - LAB_MANAGER may only reject bookings from their assigned laboratories
 *   (out-of-scope bookings answer 404 before any write).
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

  const parsed = labBookingRejectSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "A rejection reason is required.",
      toFieldIssues(parsed.error),
    );
  }

  try {
    await connectToDatabase();

    const booking = await LabBooking.findOne({
      _id: parsedId.data.id,
      ...scopeFilter(user),
    }).lean();
    if (!booking) {
      return errorResponse(404, "Booking not found.");
    }

    if (booking.status !== "PENDING") {
      return errorResponse(
        409,
        "Only requests awaiting review can be rejected. Refresh and try again.",
      );
    }

    const dateString = booking.bookingDate.toISOString().slice(0, 10);

    // Conditional flip: only one concurrent reviewer wins this update.
    const rejected = await LabBooking.findOneAndUpdate(
      { _id: parsedId.data.id, status: "PENDING" },
      {
        $set: {
          status: "REJECTED",
          rejectionReason: parsed.data.reason,
          reviewedBy: user.id,
          reviewedAt: new Date(),
        },
      },
      { new: true, runValidators: true },
    )
      .populate("laboratoryId", "name code isActive")
      .populate("patientId", "name")
      .populate("reviewedBy", "name")
      .lean();

    if (!rejected) {
      return errorResponse(
        409,
        "This request was already reviewed. Refresh and try again.",
      );
    }

    await appendBookingEvent({
      bookingId: String(booking._id),
      eventType: "REQUEST_REJECTED",
      previousStatus: "PENDING",
      newStatus: "REJECTED",
      actorId: user.id,
      metadata: { reason: parsed.data.reason.slice(0, 500) },
    });

    // REJECTED is not a capacity-holding status: release the reserved slot.
    await releaseSlotQuietly({
      laboratoryId: String(booking.laboratoryId),
      date: dateString,
      timeSlot: booking.timeSlot,
    });

    return itemResponse(toLabBookingDetailDto(rejected));
  } catch (error) {
    logApiFailure("lab-bookings/[id]/reject", error);
    return errorResponse(
      503,
      "Unable to reject the request right now. Please try again.",
    );
  }
}
