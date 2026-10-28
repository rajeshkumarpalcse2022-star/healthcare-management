import { NextResponse } from "next/server";

import {
  CANCELLABLE_STATUSES,
  canCancelAnyAppointment,
} from "@/config/appointments";
import { authErrorResponse, requireAuth } from "@/lib/auth";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import {
  appointmentVisibleTo,
  getActiveDoctorProfileForUser,
  isAppointmentDoctor,
  isAppointmentPatient,
} from "@/lib/appointment/authorization";
import { toAppointmentDetailDto } from "@/lib/appointment/dto";
import { appendAppointmentEvent } from "@/lib/appointment/events";
import {
  releaseAppointmentSlotQuietly,
} from "@/lib/appointment/slots";
import { connectToDatabase } from "@/lib/db";
import {
  appointmentCancelSchema,
  appointmentIdSchema,
} from "@/lib/validation/appointment";
import { toFieldIssues } from "@/lib/validation/common";
import { Appointment } from "@/models/Appointment";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

function slotKeyOf(appointment: {
  doctorId: unknown;
  appointmentDate: unknown;
  timeSlot: string;
}) {
  const doctorId =
    typeof appointment.doctorId === "object" && "_id" in (appointment.doctorId as object)
      ? String((appointment.doctorId as { _id: unknown })._id)
      : String(appointment.doctorId);
  return {
    doctorId,
    date: new Date(String(appointment.appointmentDate))
      .toISOString()
      .slice(0, 10),
    timeSlot: appointment.timeSlot,
  };
}

/**
 * PATCH /api/appointments/[id]/cancel
 *
 * Cancels a pending or confirmed appointment: the owning patient, the
 * owning doctor, or super admin / admin. Cancellation is terminal - the
 * attempt keeps its history row - and the held slot capacity is released
 * atomically so the time becomes bookable again.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireAuth();
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { id } = await context.params;
  const idParsed = appointmentIdSchema.safeParse({ id });
  if (!idParsed.success) {
    return errorResponse(400, "Invalid appointment id.", toFieldIssues(idParsed.error));
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = appointmentCancelSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check the cancellation details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const reason = parsed.data.reason ?? null;

  try {
    await connectToDatabase();

    const appointment = await Appointment.findById(idParsed.data.id)
      .populate("doctorId", "name specialization qualification consultationFee profileImageUrl")
      .populate("clinicId", "name city isActive imageUrl")
      .populate("patientId", "name email phone")
      .lean();
    if (!appointment) {
      return errorResponse(404, "Appointment not found.");
    }

    const doctorProfile =
      user.role === "DOCTOR"
        ? await getActiveDoctorProfileForUser(user.id)
        : null;
    const doctorProfileId = doctorProfile ? String(doctorProfile._id) : null;

    if (!appointmentVisibleTo(user, appointment, doctorProfileId)) {
      return errorResponse(404, "Appointment not found.");
    }

    const patientOwner = isAppointmentPatient(user, appointment);
    const doctorOwner = isAppointmentDoctor(user, appointment, doctorProfileId);
    if (
      !patientOwner &&
      !doctorOwner &&
      !canCancelAnyAppointment(user.role)
    ) {
      return errorResponse(
        403,
        "You do not have permission to cancel this appointment.",
      );
    }

    const currentStatus = appointment.status;
    if (!CANCELLABLE_STATUSES.includes(currentStatus)) {
      return errorResponse(
        409,
        `A ${currentStatus.toLowerCase()} appointment can no longer be cancelled.`,
      );
    }

    const now = new Date();
    const updated = await Appointment.findOneAndUpdate(
      {
        _id: appointment._id,
        status: { $in: [...CANCELLABLE_STATUSES] },
      },
      {
        $set: {
          status: "CANCELLED",
          cancelledAt: now,
          cancellationReason: reason,
        },
      },
      { new: true },
    );
    if (!updated) {
      return errorResponse(
        409,
        "This appointment changed while you were reviewing it. Reload and try again.",
      );
    }

    // Release the held slot; quiet release so a bookkeeping hiccup never
    // turns a successful cancellation into a 5xx (over-count is safe).
    await releaseAppointmentSlotQuietly(slotKeyOf(appointment));

    await appendAppointmentEvent({
      appointmentId: String(updated._id),
      eventType: "APPOINTMENT_CANCELLED",
      previousStatus: currentStatus,
      newStatus: "CANCELLED",
      actorId: user.id,
      ...(reason ? { metadata: { reason } } : {}),
    });

    const populated = await Appointment.findById(updated._id)
      .populate("doctorId", "name specialization qualification consultationFee profileImageUrl")
      .populate("clinicId", "name city isActive imageUrl")
      .populate("patientId", "name email phone")
      .lean();

    return itemResponse(
      toAppointmentDetailDto(populated ?? updated.toObject()),
    );
  } catch (error) {
    logApiFailure("appointments/cancel", error);
    return errorResponse(
      503,
      "Unable to cancel the appointment right now. Please try again.",
    );
  }
}
