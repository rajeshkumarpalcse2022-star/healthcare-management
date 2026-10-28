import { NextResponse } from "next/server";

import { CANCELLATION_CUTOFF_HOURS } from "@/config/lab-bookings";
import { authErrorResponse, requireAuth } from "@/lib/auth";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import { toLabBookingDetailDto } from "@/lib/api/serializers";
import { connectToDatabase } from "@/lib/db";
import { canCancelBooking } from "@/lib/lab-booking/authorization";
import { appendBookingEvent } from "@/lib/lab-booking/events";
import { releaseSlotQuietly } from "@/lib/lab-booking/slots";
import { LabBooking } from "@/models/LabBooking";
import { toFieldIssues } from "@/lib/validation/common";
import {
  labBookingCancelSchema,
  labBookingIdSchema,
} from "@/lib/validation/lab-booking";
import { cancellationDeadline } from "@/lib/utils/booking-time";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/lab-bookings/[id]/cancel
 *
 * Cancels an eligible booking. Rules (all enforced server-side):
 * - only the owning patient or an operational cancel role may cancel;
 * - PENDING and CONFIRMED bookings are cancellable; CANCELLED / COMPLETED
 *   are not, so a cancelled booking can never be cancelled twice;
 * - the configured cutoff must not have passed yet (laboratory timezone);
 * - the status flip is a single conditional update, so concurrent duplicate
 *   requests produce exactly one winner - the loser gets 409 and no second
 *   capacity release happens;
 * - a successful cancellation releases the reserved slot capacity and keeps
 *   the record (with reason and timestamp) for audit history.
 * - LAB_MANAGER/STAFF accounts only cancel bookings from their assigned
 *   laboratories (out-of-scope bookings answer 404 - no existence probing).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireAuth();
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { id } = await params;
  const parsedId = labBookingIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid booking id.");
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = labBookingCancelSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  try {
    await connectToDatabase();

    const booking = await LabBooking.findById(parsedId.data.id).lean();
    if (!booking || !canCancelBooking(user, booking)) {
      // Same 404 for "missing" and "not yours" - no existence probing.
      return errorResponse(404, "Booking not found.");
    }

    if (booking.status === "CANCELLED") {
      return errorResponse(409, "This booking has already been cancelled.");
    }
    if (booking.status === "COMPLETED") {
      return errorResponse(
        409,
        "Completed bookings cannot be cancelled.",
      );
    }

    const dateString = booking.bookingDate.toISOString().slice(0, 10);
    const deadline = cancellationDeadline(
      dateString,
      booking.timeSlot,
      booking.timezone,
      CANCELLATION_CUTOFF_HOURS,
    );
    if (deadline && Date.now() >= deadline.getTime()) {
      return errorResponse(
        409,
        `Bookings can only be cancelled at least ${CANCELLATION_CUTOFF_HOURS} hour(s) before the scheduled slot.`,
      );
    }

    // Conditional flip: only one concurrent request can win this update.
    const cancelled = await LabBooking.findOneAndUpdate(
      {
        _id: parsedId.data.id,
        status: { $in: ["PENDING", "CONFIRMED"] },
      },
      {
        $set: {
          status: "CANCELLED",
          cancellationReason: parsed.data.reason ?? null,
          cancelledAt: new Date(),
        },
      },
      { new: true, runValidators: true },
    )
      .populate("laboratoryId", "name code isActive")
      .populate("patientId", "name")
      .lean();

    if (!cancelled) {
      return errorResponse(409, "This booking can no longer be cancelled.");
    }

    await appendBookingEvent({
      bookingId: String(booking._id),
      eventType: "REQUEST_CANCELLED",
      previousStatus: booking.status,
      newStatus: "CANCELLED",
      actorId: user.id,
      metadata: parsed.data.reason
        ? { reason: parsed.data.reason.slice(0, 500) }
        : null,
    });

    // Release the reserved capacity only after the successful transition.
    // A release failure is swallowed (logged) so it cannot turn a successful
    // cancel into a 5xx; over-counting capacity is conservative - it never
    // allows overbooking.
    await releaseSlotQuietly({
      laboratoryId: String(booking.laboratoryId),
      date: dateString,
      timeSlot: booking.timeSlot,
    });

    return itemResponse(toLabBookingDetailDto(cancelled));
  } catch (error) {
    logApiFailure("lab-bookings/[id]/cancel", error);
    return errorResponse(
      503,
      "Unable to cancel the booking right now. Please try again.",
    );
  }
}
