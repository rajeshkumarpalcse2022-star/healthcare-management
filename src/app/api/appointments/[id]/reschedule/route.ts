import { NextResponse } from "next/server";

import {
  APPOINTMENT_SLOT_CAPACITY,
  CANCELLABLE_STATUSES,
  canCancelAnyAppointment,
} from "@/config/appointments";
import { authErrorResponse, requireAuth } from "@/lib/auth";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import {
  appointmentVisibleTo,
  getActiveDoctorProfileForUser,
  getDoctorProfileById,
  isAppointmentDoctor,
  isAppointmentPatient,
  refId,
} from "@/lib/appointment/authorization";
import {
  doctorClinicIds,
  getDoctorClinicSchedule,
} from "@/lib/appointment/clinic-assignments";
import { toAppointmentDetailDto } from "@/lib/appointment/dto";
import { appendAppointmentEvent } from "@/lib/appointment/events";
import { verifyAppointmentSlot } from "@/lib/appointment/schedule";
import {
  claimAppointmentSlot,
  releaseAppointmentSlotQuietly,
} from "@/lib/appointment/slots";
import { connectToDatabase } from "@/lib/db";
import {
  appointmentIdSchema,
  appointmentRescheduleSchema,
} from "@/lib/validation/appointment";
import { toFieldIssues } from "@/lib/validation/common";
import { Appointment } from "@/models/Appointment";
import { Clinic } from "@/models/Clinic";
import { slotEnd } from "@/lib/utils/booking-time";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

function dateOnlyOf(value: unknown): string {
  return new Date(String(value)).toISOString().slice(0, 10);
}

/**
 * PATCH /api/appointments/[id]/reschedule
 *
 * Moves a pending or confirmed appointment to a new date/slot: the owning
 * patient, the owning doctor, or super admin / admin. The new slot is
 * verified against the doctor's *current* schedule and claimed atomically
 * BEFORE the appointment moves; the old slot is only released after the
 * conditional update succeeds (a failed move rolls the new claim back), so
 * the appointment can never end up holding zero slots or double-hold two.
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = appointmentRescheduleSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check the new appointment time and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const input = parsed.data;

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
        "You do not have permission to reschedule this appointment.",
      );
    }

    const currentStatus = appointment.status;
    if (!CANCELLABLE_STATUSES.includes(currentStatus)) {
      return errorResponse(
        409,
        `A ${currentStatus.toLowerCase()} appointment can no longer be rescheduled.`,
      );
    }

    const doctorId =
      typeof appointment.doctorId === "object" && "_id" in (appointment.doctorId as object)
        ? String((appointment.doctorId as { _id: unknown })._id)
        : String(appointment.doctorId);

    const doctor = await getDoctorProfileById(doctorId);
    if (!doctor || !doctor.isActive) {
      return errorResponse(
        409,
        "This doctor is not currently accepting appointments.",
      );
    }

    const clinicId = refId(appointment.clinicId);
    if (!clinicId || !doctorClinicIds(doctor).includes(clinicId)) {
      return errorResponse(
        409,
        "This appointment's clinic is no longer linked to the doctor.",
      );
    }

    const clinic = await Clinic.findById(clinicId)
      .select("name isActive")
      .lean();
    if (!clinic || !clinic.isActive) {
      return errorResponse(
        409,
        "This doctor's clinic is not currently accepting appointments.",
      );
    }

    const scheduleConfig = getDoctorClinicSchedule(doctor, clinicId);
    const check = verifyAppointmentSlot(
      scheduleConfig,
      input.appointmentDate,
      input.timeSlot,
    );
    if (!check.ok) {
      return errorResponse(409, check.message, [
        { field: check.field, message: check.message },
      ]);
    }

    const oldDate = dateOnlyOf(appointment.appointmentDate);
    const oldSlot = appointment.timeSlot;
    const oldKey = { doctorId, date: oldDate, timeSlot: oldSlot };
    const newKey = {
      doctorId,
      date: input.appointmentDate,
      timeSlot: input.timeSlot,
    };

    // Nothing to do when the time is unchanged.
    if (oldDate === input.appointmentDate && oldSlot === input.timeSlot) {
      return itemResponse(toAppointmentDetailDto(appointment));
    }

    /* ---------------- atomic claim of the NEW slot first ---------------- */
    const claimed = await claimAppointmentSlot(
      newKey,
      check.slotCapacity || APPOINTMENT_SLOT_CAPACITY,
    );
    if (!claimed) {
      return errorResponse(
        409,
        "The selected time slot is already taken. Choose another slot.",
        [{ field: "timeSlot", message: "No capacity left in this slot." }],
      );
    }

    let updated;
    try {
      updated = await Appointment.findOneAndUpdate(
        {
          _id: appointment._id,
          status: { $in: [...CANCELLABLE_STATUSES] },
          appointmentDate: appointment.appointmentDate,
          timeSlot: oldSlot,
        },
        {
          $set: {
            appointmentDate: new Date(
              `${input.appointmentDate}T00:00:00.000Z`,
            ),
            timeSlot: input.timeSlot,
            endTime: slotEnd(
              input.timeSlot,
              check.slotDurationMinutes,
            ),
            timezone: check.timezone,
          },
        },
        { new: true },
      );
    } catch (error) {
      await releaseAppointmentSlotQuietly(newKey);
      throw error;
    }

    if (!updated) {
      // Status or time changed concurrently - give the new claim back.
      await releaseAppointmentSlotQuietly(newKey);
      return errorResponse(
        409,
        "This appointment changed while you were reviewing it. Reload and try again.",
      );
    }

    // The move succeeded: release the OLD slot (quiet - over-count is the
    // safe direction and the appointment itself already moved).
    await releaseAppointmentSlotQuietly(oldKey);

    await appendAppointmentEvent({
      appointmentId: String(updated._id),
      eventType: "APPOINTMENT_RESCHEDULED",
      previousStatus: currentStatus,
      newStatus: currentStatus,
      actorId: user.id,
      metadata: {
        reason: `Moved from ${oldDate} ${oldSlot} to ${input.appointmentDate} ${input.timeSlot}`,
        previousDate: oldDate,
        previousTimeSlot: oldSlot,
        appointmentDate: input.appointmentDate,
        timeSlot: input.timeSlot,
      },
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
    logApiFailure("appointments/reschedule", error);
    return errorResponse(
      503,
      "Unable to reschedule the appointment right now. Please try again.",
    );
  }
}
