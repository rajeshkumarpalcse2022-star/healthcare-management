import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireRole } from "@/lib/auth";
import {
  errorResponse,
  itemResponse,
  logApiFailure,
} from "@/lib/api/response";
import { getActiveDoctorProfileForUser } from "@/lib/appointment/authorization";
import { connectToDatabase } from "@/lib/db";
import { patientIdSchema } from "@/lib/validation/patient";
import { Appointment } from "@/models/Appointment";
import { ConsultationRecord } from "@/models/ConsultationRecord";
import { User } from "@/models/User";
import type {
  DoctorPatientDetail,
  DoctorPatientSummary,
  DoctorPatientVisit,
} from "@/types/patient";

export const dynamic = "force-dynamic";

interface PatientLean {
  _id: unknown;
  name: string;
  email: string;
  phone?: string | null;
}

interface AppointmentLean {
  _id: unknown;
  appointmentCode: string;
  appointmentDate: Date;
  timeSlot: string;
  endTime: string;
  appointmentType: DoctorPatientVisit["appointmentType"];
  reason: string | null;
}

interface ConsultationLean {
  appointmentId: unknown;
  diagnosis: string | null;
  treatmentAdvice: string | null;
  followUp: string | null;
  prescriptionItems: unknown[];
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * GET /api/doctor/patients/[id]
 *
 * Patient identity plus every COMPLETED visit this patient had with the
 * signed-in doctor. Used by the eye action in the "Completed visits" column
 * on `/doctor/patients`.
 *
 * Visibility is derived entirely server-side from the caller's linked, active
 * Doctor profile. A patient with no completed appointment with this doctor
 * resolves to 404, so the endpoint cannot be used to probe the wider patient
 * directory. Consultation summaries are limited to records this doctor wrote
 * for the same appointments.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let user;
  try {
    user = await requireRole(ROLES.DOCTOR);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { id } = await params;
  const parsedId = patientIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid patient id.");
  }

  try {
    await connectToDatabase();

    const profile = await getActiveDoctorProfileForUser(user.id);
    if (!profile) {
      return errorResponse(
        403,
        "Your doctor profile is not active yet. Complete the approval process first.",
      );
    }

    const patient = await User.findOne({
      _id: parsedId.data.id,
      role: ROLES.PATIENT,
    })
      .select("_id name email phone")
      .lean<PatientLean | null>();

    if (!patient) {
      return errorResponse(404, "Patient not found.");
    }

    const appointments = await Appointment.find({
      doctorId: profile._id,
      patientId: patient._id,
      status: "COMPLETED",
    })
      .sort({ appointmentDate: -1, timeSlot: -1 })
      .select(
        "_id appointmentCode appointmentDate timeSlot endTime appointmentType reason",
      )
      .lean<AppointmentLean[]>();

    if (appointments.length === 0) {
      return errorResponse(404, "Patient not found.");
    }

    const appointmentIds = appointments.map((appointment) => appointment._id);

    const consultations = await ConsultationRecord.find({
      doctorId: profile._id,
      appointmentId: { $in: appointmentIds },
    })
      .select("appointmentId diagnosis treatmentAdvice followUp prescriptionItems")
      .lean<ConsultationLean[]>();

    const consultationByAppointment = new Map(
      consultations.map((consultation) => [
        String(consultation.appointmentId),
        consultation,
      ]),
    );

    const summary: DoctorPatientSummary = {
      id: String(patient._id),
      name: patient.name,
      email: patient.email,
      phone: patient.phone ?? null,
      visits: appointments.length,
      firstVisit: dateOnly(appointments[appointments.length - 1].appointmentDate),
      lastVisit: dateOnly(appointments[0].appointmentDate),
    };

    const visits: DoctorPatientVisit[] = appointments.map((appointment) => {
      const consultation = consultationByAppointment.get(String(appointment._id));

      return {
        id: String(appointment._id),
        appointmentCode: appointment.appointmentCode,
        date: dateOnly(appointment.appointmentDate),
        timeSlot: appointment.timeSlot,
        endTime: appointment.endTime,
        appointmentType: appointment.appointmentType,
        reason: appointment.reason,
        consultation: consultation
          ? {
              diagnosis: consultation.diagnosis,
              treatmentAdvice: consultation.treatmentAdvice,
              followUp: consultation.followUp,
              prescriptionCount: consultation.prescriptionItems.length,
            }
          : null,
      };
    });

    return itemResponse<DoctorPatientDetail>({ patient: summary, visits });
  } catch (error) {
    logApiFailure("doctor/patients/[id]", error);
    return errorResponse(
      503,
      "Unable to load this patient right now. Please try again.",
    );
  }
}
