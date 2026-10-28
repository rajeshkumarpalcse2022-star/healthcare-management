import { NextResponse } from "next/server";

import { authErrorResponse, requireAuth } from "@/lib/auth";
import {
  errorResponse,
  itemResponse,
  logApiFailure,
} from "@/lib/api/response";
import {
  appointmentVisibleTo,
  getActiveDoctorProfileForUser,
} from "@/lib/appointment/authorization";
import {
  toAppointmentDetailDto,
  toAppointmentEventDto,
} from "@/lib/appointment/dto";
import { connectToDatabase } from "@/lib/db";
import { appointmentIdSchema } from "@/lib/validation/appointment";
import { toFieldIssues } from "@/lib/validation/common";
import { Appointment } from "@/models/Appointment";
import { AppointmentEvent } from "@/models/AppointmentEvent";
import { ConsultationRecord } from "@/models/ConsultationRecord";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/appointments/[id]
 *
 * Full appointment detail for authorised viewers only: the owning patient,
 * the owning doctor (through the linked profile), or super admin / admin.
 * Anyone else - including other doctors and patients - receives 404 so
 * appointment references cannot be probed. The audit history is included
 * because detail access is already authorised.
 */
export async function GET(
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
  const parsed = appointmentIdSchema.safeParse({ id });
  if (!parsed.success) {
    return errorResponse(400, "Invalid appointment id.", toFieldIssues(parsed.error));
  }

  try {
    await connectToDatabase();

    const appointment = await Appointment.findById(parsed.data.id)
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
    if (
      !appointmentVisibleTo(
        user,
        appointment,
        doctorProfile ? String(doctorProfile._id) : null,
      )
    ) {
      return errorResponse(404, "Appointment not found.");
    }

    const [events, consultation] = await Promise.all([
      AppointmentEvent.find({ appointmentId: appointment._id })
        .sort({ createdAt: -1 })
        .populate("actorId", "name")
        .lean(),
      ConsultationRecord.exists({ appointmentId: appointment._id }),
    ]);

    return itemResponse(
      toAppointmentDetailDto(appointment, {
        history: events.map(toAppointmentEventDto),
        hasConsultation: Boolean(consultation),
      }),
    );
  } catch (error) {
    logApiFailure("appointments/detail", error);
    return errorResponse(
      503,
      "Unable to load the appointment right now. Please try again.",
    );
  }
}
