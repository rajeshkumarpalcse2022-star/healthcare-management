import { NextResponse } from "next/server";

import {
  canTransitionAppointmentStatus,
  canReviewAnyAppointment,
  type AppointmentEventType,
  type AppointmentStatus,
} from "@/config/appointments";
import { authErrorResponse, requireAuth } from "@/lib/auth";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import {
  appointmentVisibleTo,
  getActiveDoctorProfileForUser,
  isAppointmentDoctor,
} from "@/lib/appointment/authorization";
import { toAppointmentDetailDto } from "@/lib/appointment/dto";
import { appendAppointmentEvent } from "@/lib/appointment/events";
import { createJitsiMeetingLink } from "@/lib/appointment/meeting";
import { connectToDatabase } from "@/lib/db";
import { appointmentIdSchema, appointmentStatusSchema } from "@/lib/validation/appointment";
import { toFieldIssues } from "@/lib/validation/common";
import { Appointment } from "@/models/Appointment";
import { ConsultationRecord } from "@/models/ConsultationRecord";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

const STATUS_EVENT: Record<AppointmentStatus, AppointmentEventType> = {
  PENDING: "STATUS_CHANGED",
  CONFIRMED: "APPOINTMENT_CONFIRMED",
  REJECTED: "APPOINTMENT_REJECTED",
  IN_PROGRESS: "CONSULTATION_STARTED",
  COMPLETED: "APPOINTMENT_COMPLETED",
  CANCELLED: "APPOINTMENT_CANCELLED",
};

/**
 * PATCH /api/appointments/[id]/status
 *
 * Forward status transitions for authorised actors:
 * - CONFIRMED / REJECTED: the owning doctor or super admin / admin
 *   (a rejection requires a reason);
 * - IN_PROGRESS / COMPLETED: the owning doctor only.
 *
 * The update is conditional on the current status, so two concurrent
 * reviewers can never both apply their transition - the loser receives 409
 * and the client refetches. CANCELLED is reachable exclusively through the
 * dedicated cancel endpoint.
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

  const parsed = appointmentStatusSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check the status change and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const { status: targetStatus, reason } = parsed.data;

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

    // Actor rules: operational start/complete is the owning doctor's alone;
    // confirmation and rejection additionally allow admin oversight.
    const doctorOwner = isAppointmentDoctor(user, appointment, doctorProfileId);
    if (targetStatus === "IN_PROGRESS" || targetStatus === "COMPLETED") {
      if (!doctorOwner) {
        return errorResponse(
          403,
          "Only the treating doctor can start or complete a consultation.",
        );
      }
    } else if (!doctorOwner && !canReviewAnyAppointment(user.role)) {
      return errorResponse(
        403,
        "You do not have permission to review appointments.",
      );
    }

    const currentStatus = appointment.status as AppointmentStatus;
    if (!canTransitionAppointmentStatus(currentStatus, targetStatus)) {
      return errorResponse(
        409,
        `This appointment is already ${currentStatus.toLowerCase()} and cannot move to ${targetStatus.toLowerCase()}.`,
      );
    }

    const now = new Date();
    const set: Record<string, unknown> = { status: targetStatus };
    if (targetStatus === "CONFIRMED") {
      set.reviewedBy = user.id;
      set.reviewedAt = now;
      // Online consultations get a free Jitsi room on confirmation; the same
      // link is shown to the doctor and the patient on the detail page.
      if (appointment.appointmentType === "ONLINE" && !appointment.meetingLink) {
        set.meetingLink = createJitsiMeetingLink(appointment.appointmentCode);
        set.meetingProvider = "JITSI";
        set.meetingCreatedAt = now;
      }
    } else if (targetStatus === "REJECTED") {
      set.reviewedBy = user.id;
      set.reviewedAt = now;
      set.rejectionReason = reason ?? null;
    } else if (targetStatus === "IN_PROGRESS") {
      set.startedBy = user.id;
      set.startedAt = now;
    } else if (targetStatus === "COMPLETED") {
      set.completedBy = user.id;
      set.completedAt = now;
    }

    const updated = await Appointment.findOneAndUpdate(
      { _id: appointment._id, status: currentStatus },
      { $set: set },
      { new: true },
    );
    if (!updated) {
      return errorResponse(
        409,
        "This appointment changed while you were reviewing it. Reload and try again.",
      );
    }

    await appendAppointmentEvent({
      appointmentId: String(updated._id),
      eventType: STATUS_EVENT[targetStatus],
      previousStatus: currentStatus,
      newStatus: targetStatus,
      actorId: user.id,
      ...(targetStatus === "REJECTED" && reason ? { metadata: { reason } } : {}),
    });

    const [populated, consultation] = await Promise.all([
      Appointment.findById(updated._id)
        .populate("doctorId", "name specialization qualification consultationFee profileImageUrl")
        .populate("clinicId", "name city isActive imageUrl")
        .populate("patientId", "name email phone")
        .lean(),
      targetStatus === "COMPLETED"
        ? ConsultationRecord.exists({ appointmentId: updated._id })
        : Promise.resolve(null),
    ]);

    return itemResponse(
      toAppointmentDetailDto(populated ?? updated.toObject(), {
        hasConsultation: Boolean(consultation),
      }),
    );
  } catch (error) {
    logApiFailure("appointments/status", error);
    return errorResponse(
      503,
      "Unable to update the appointment right now. Please try again.",
    );
  }
}
