import { NextResponse } from "next/server";

import { appointmentTypeLabel } from "@/config/appointments";
import { authErrorResponse, requireAuth } from "@/lib/auth";
import { errorResponse, logApiFailure } from "@/lib/api/response";
import {
  appointmentVisibleTo,
  getActiveDoctorProfileForUser,
  isAppointmentDoctor,
  isAppointmentPatient,
} from "@/lib/appointment/authorization";
import {
  buildConsultationDocumentPdf,
  type ConsultationDocumentData,
  type ConsultationDocumentType,
} from "@/lib/appointment/consultation-documents";
import { connectToDatabase } from "@/lib/db";
import { appointmentIdSchema } from "@/lib/validation/appointment";
import { toFieldIssues } from "@/lib/validation/common";
import { Appointment } from "@/models/Appointment";
import { ConsultationRecord } from "@/models/ConsultationRecord";
// Import side-effect: registers the "Clinic" model that the populated
// `appointment.clinicId` references by name. Without it, `.populate()`
// throws MissingSchemaError and this route returns 503.
import "@/models/Clinic";
import type { SafeUser } from "@/types/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PopulatedRef {
  _id?: unknown;
  name?: unknown;
  specialization?: unknown;
  qualification?: unknown;
  registrationNumber?: unknown;
  consultationFee?: unknown;
  email?: unknown;
  phone?: unknown;
  code?: unknown;
  address?: unknown;
  city?: unknown;
  state?: unknown;
  pincode?: unknown;
}

function refOf(value: unknown): PopulatedRef {
  return value && typeof value === "object" ? (value as PopulatedRef) : {};
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * GET /api/appointments/[id]/consultation/document?type=invoice|prescription
 *
 * Downloads the consultation invoice or prescription as a PDF. The same
 * visibility rules as the consultation record apply: the owning doctor may
 * download at any time, the patient only after the appointment is completed.
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
  const idParsed = appointmentIdSchema.safeParse({ id });
  if (!idParsed.success) {
    return errorResponse(400, "Invalid appointment id.", toFieldIssues(idParsed.error));
  }

  const requestedType = new URL(request.url).searchParams.get("type");
  if (
    requestedType !== null &&
    requestedType !== "invoice" &&
    requestedType !== "prescription"
  ) {
    return errorResponse(400, "Choose a valid document type.");
  }
  const type: ConsultationDocumentType =
    requestedType === "invoice" ? "invoice" : "prescription";

  try {
    await connectToDatabase();

    const appointment = await Appointment.findById(idParsed.data.id)
      .populate(
        "doctorId",
        "name specialization qualification registrationNumber consultationFee",
      )
      .populate("clinicId", "name code phone email address city state pincode")
      .populate("patientId", "name email phone")
      .lean();
    if (!appointment) {
      return errorResponse(404, "Consultation record not found.");
    }

    const doctorProfile =
      user.role === "DOCTOR"
        ? await getActiveDoctorProfileForUser(user.id)
        : null;
    const doctorProfileId = doctorProfile ? String(doctorProfile._id) : null;

    if (!appointmentVisibleTo(user, appointment, doctorProfileId)) {
      return errorResponse(404, "Consultation record not found.");
    }

    const doctorOwner = isAppointmentDoctor(user, appointment, doctorProfileId);
    const patientOwner = isAppointmentPatient(user, appointment);
    if (!doctorOwner && !patientOwner) {
      return errorResponse(404, "Consultation record not found.");
    }
    if (patientOwner && appointment.status !== "COMPLETED") {
      return errorResponse(
        404,
        "This consultation record becomes available once the appointment is completed.",
      );
    }

    const record = await ConsultationRecord.findOne({
      appointmentId: appointment._id,
    }).lean();
    if (!record) {
      return errorResponse(404, "Consultation record not found.");
    }

    const doctor = refOf(appointment.doctorId);
    const clinic = refOf(appointment.clinicId);
    const patient = refOf(appointment.patientId);
    const appointmentDate =
      appointment.appointmentDate instanceof Date
        ? appointment.appointmentDate.toISOString().slice(0, 10)
        : new Date(String(appointment.appointmentDate)).toISOString().slice(0, 10);

    const data: ConsultationDocumentData = {
      appointment: {
        code: String(appointment.appointmentCode ?? ""),
        date: appointmentDate,
        timeSlot: String(appointment.timeSlot ?? ""),
        endTime: String(appointment.endTime ?? ""),
        type: appointmentTypeLabel(String(appointment.appointmentType ?? "")),
      },
      clinic: {
        name: textOf(clinic.name) ?? "Clinic",
        code: textOf(clinic.code) ?? "",
        phone: textOf(clinic.phone),
        email: textOf(clinic.email),
        address: textOf(clinic.address),
        city: textOf(clinic.city),
        state: textOf(clinic.state),
        pincode: textOf(clinic.pincode),
      },
      doctor: {
        name: textOf(doctor.name) ?? "Doctor",
        specialization: textOf(doctor.specialization) ?? "",
        qualification: textOf(doctor.qualification),
        registrationNumber: textOf(doctor.registrationNumber),
        consultationFee:
          typeof doctor.consultationFee === "number"
            ? doctor.consultationFee
            : null,
      },
      patient: {
        name: textOf(patient.name) ?? "Patient",
        email: textOf(patient.email),
        phone: textOf(patient.phone),
      },
      record: {
        diagnosis: record.diagnosis ?? null,
        notes: record.notes ?? null,
        treatmentAdvice: record.treatmentAdvice ?? null,
        followUp: record.followUp ?? null,
        prescriptionItems: (record.prescriptionItems ?? []).map((item) => ({
          medicine: item.medicine,
          dosage: item.dosage,
          frequency: item.frequency,
          duration: item.duration,
          instructions: item.instructions ?? null,
        })),
        attachments: (record.attachments ?? []).map((attachment) => ({
          fileName: attachment.fileName,
          url: attachment.url,
          mimeType: attachment.mimeType,
          size: attachment.size,
          uploadedAt: new Date(attachment.uploadedAt).toISOString(),
        })),
        updatedAt: new Date(record.updatedAt).toISOString(),
      },
    };

    const bytes = await buildConsultationDocumentPdf(type, data);
    const safeCode = data.appointment.code.replace(/[^A-Za-z0-9_-]+/g, "-");
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${type}-${safeCode}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    logApiFailure("appointments/consultation/document", error);
    return errorResponse(
      503,
      "Unable to prepare the document right now. Please try again.",
    );
  }
}
