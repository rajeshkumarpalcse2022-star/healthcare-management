import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireAuth } from "@/lib/auth";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import {
  toLabBookingDetailDto,
  toLabBookingEventDto,
} from "@/lib/api/serializers";
import { connectToDatabase } from "@/lib/db";
import { canViewBooking } from "@/lib/lab-booking/authorization";
import { LabBooking } from "@/models/LabBooking";
import { LabBookingEvent } from "@/models/LabBookingEvent";
import { labBookingIdSchema } from "@/lib/validation/lab-booking";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/lab-bookings/[id]
 *
 * Booking detail for the current user only:
 * - the owning patient sees their own booking;
 * - operational roles see any booking.
 * Anyone else receives 404 (not 403) so booking references cannot be probed
 * for existence. LAB_MANAGER/STAFF accounts with assignments receive the
 * same 404 for bookings from laboratories outside their scope (scope
 * enforced in `canViewBooking`). Private responses carry
 * `Cache-Control: no-store` via the shared envelope.
 *
 * The item test reference is populated so specimen requirements can be shown
 * alongside the immutable code/name/price snapshot, and the audit timeline is
 * included for the owner and operational viewers only.
 */
export async function GET(
  _request: Request,
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

  try {
    await connectToDatabase();

    const booking = await LabBooking.findById(parsedId.data.id)
      .populate("laboratoryId", "name code isActive")
      .populate("patientId", "name")
      .populate("reviewedBy", "name")
      .populate("items.labTestId", "specimenType preparationInstructions")
      .lean();

    if (!booking || !canViewBooking(user, booking)) {
      return errorResponse(404, "Booking not found.");
    }

    const detail = toLabBookingDetailDto(booking);

    const isOwner =
      user.role === ROLES.PATIENT &&
      detail.patient !== null &&
      detail.patient.id === user.id;
    const isManagement =
      user.role === ROLES.SUPER_ADMIN ||
      user.role === ROLES.ADMIN ||
      user.role === ROLES.LAB_MANAGER ||
      user.role === ROLES.STAFF;

    // Audit timeline is only meaningful to operational viewers and the owner.
    if (isOwner || isManagement) {
      const events = await LabBookingEvent.find({ bookingId: booking._id })
        .sort({ createdAt: -1 })
        .limit(50)
        .populate("actorId", "name")
        .lean();
      detail.history = events.map(toLabBookingEventDto);
    }

    return itemResponse(detail);
  } catch (error) {
    logApiFailure("lab-bookings/[id]", error);
    return errorResponse(
      503,
      "Unable to load the booking right now. Please try again.",
    );
  }
}
