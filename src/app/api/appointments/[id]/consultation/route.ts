import { NextResponse } from "next/server";
import { Types } from "mongoose";

import { CONSULTATION_CHANGE_HISTORY_LIMIT } from "@/config/appointments";
import { authErrorResponse, requireAuth } from "@/lib/auth";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import {
  appointmentVisibleTo,
  getActiveDoctorProfileForUser,
  isAppointmentDoctor,
  isAppointmentPatient,
} from "@/lib/appointment/authorization";
import { toConsultationRecordDto } from "@/lib/appointment/dto";
import { connectToDatabase } from "@/lib/db";
import {
  appointmentIdSchema,
  consultationUpsertSchema,
} from "@/lib/validation/appointment";
import { toFieldIssues } from "@/lib/validation/common";
import { Appointment } from "@/models/Appointment";
import { ConsultationRecord } from "@/models/ConsultationRecord";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

const APPOINTMENT_POPULATE =
  "appointmentCode appointmentDate timeSlot appointmentType status reason";

/**
 * GET /api/appointments/[id]/consultation
 *
 * Reads the consultation record of one appointment:
 * - the owning doctor may read it while the consultation is in progress or
 *   after completion (404 when no record exists yet);
 * - the owning patient may read it only once the appointment is COMPLETED
 *   (released medical record);
 * - administrative roles and other doctors have no clinical-note access.
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

  try {
    await connectToDatabase();

    const appointment = await Appointment.findById(idParsed.data.id).lean();
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
      // Monitoring roles can see the appointment but not its clinical notes.
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
    })
      .populate("appointmentId", APPOINTMENT_POPULATE)
      .populate("patientId", "name")
      .populate("doctorId", "name specialization")
      .populate("createdBy", "name")
      .populate("updatedBy", "name")
      .lean();
    if (!record) {
      return errorResponse(404, "Consultation record not found.");
    }

    return itemResponse(
      toConsultationRecordDto(record, { includeHistory: true }),
    );
  } catch (error) {
    logApiFailure("appointments/consultation", error);
    return errorResponse(
      503,
      "Unable to load the consultation record right now. Please try again.",
    );
  }
}

/**
 * PUT /api/appointments/[id]/consultation
 *
 * Creates or updates the consultation record - the owning doctor only, and
 * only while the appointment is IN_PROGRESS or COMPLETED. Every update
 * appends a capped `changeHistory` entry with the actor and the field names
 * that changed, so important clinical-record changes stay auditable.
 */
export async function PUT(
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

  const parsed = consultationUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check the consultation record and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const input = parsed.data;

  try {
    await connectToDatabase();

    const appointment = await Appointment.findById(idParsed.data.id).lean();
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

    if (!isAppointmentDoctor(user, appointment, doctorProfileId)) {
      return errorResponse(
        403,
        "Only the treating doctor can write this consultation record.",
      );
    }

    if (
      appointment.status !== "IN_PROGRESS" &&
      appointment.status !== "COMPLETED"
    ) {
      return errorResponse(
        409,
        "Start the consultation before writing the record.",
      );
    }

    const existing = await ConsultationRecord.findOne({
      appointmentId: appointment._id,
    });
    const now = new Date();
    const actorId = new Types.ObjectId(user.id);
    const previousAttachments = existing?.attachments ?? [];

    const values = {
      notes: input.notes ?? null,
      diagnosis: input.diagnosis ?? null,
      treatmentAdvice: input.treatmentAdvice ?? null,
      followUp: input.followUp ?? null,
      prescriptionItems: (input.prescriptionItems ?? []).map((item) => ({
        medicine: item.medicine,
        dosage: item.dosage,
        frequency: item.frequency,
        duration: item.duration,
        instructions: item.instructions ?? null,
      })),
      attachments: (input.attachments ?? []).map((attachment) => {
        const previous = previousAttachments.find(
          (entry) => entry.url === attachment.url,
        );
        return {
          fileName: attachment.fileName,
          url: attachment.url,
          mimeType: attachment.mimeType,
          size: attachment.size,
          uploadedAt: previous?.uploadedAt ?? now,
          uploadedBy: previous?.uploadedBy ?? actorId,
        };
      }),
    };

    if (existing) {
      const changedFields: string[] = (
        ["notes", "diagnosis", "treatmentAdvice", "followUp"] as const
      ).filter(
        (field) => (existing[field] ?? null) !== (values[field] ?? null),
      );
      const prescriptionsChanged =
        JSON.stringify(existing.prescriptionItems ?? []) !==
        JSON.stringify(values.prescriptionItems);
      if (prescriptionsChanged) changedFields.push("prescriptionItems");

      const attachmentSignature = (
        items: { fileName: string; url: string; mimeType: string; size: number }[],
      ) =>
        JSON.stringify(
          items.map((item) => [
            item.fileName,
            item.url,
            item.mimeType,
            item.size,
          ]),
        );
      const attachmentsChanged =
        attachmentSignature(existing.attachments ?? []) !==
        attachmentSignature(values.attachments);
      if (attachmentsChanged) changedFields.push("attachments");

      if (changedFields.length === 0) {
        const unchanged = await ConsultationRecord.findById(existing._id)
          .populate("appointmentId", APPOINTMENT_POPULATE)
          .populate("patientId", "name")
          .populate("doctorId", "name specialization")
          .populate("createdBy", "name")
          .populate("updatedBy", "name")
          .lean();
        return itemResponse(
          toConsultationRecordDto(unchanged ?? existing.toObject(), {
            includeHistory: true,
          }),
        );
      }

      existing.set(values);
      existing.updatedBy = new Types.ObjectId(user.id);
      existing.changeHistory = [
        {
          changedBy: new Types.ObjectId(user.id),
          changedAt: now,
          changedFields,
        },
        ...existing.changeHistory,
      ].slice(0, CONSULTATION_CHANGE_HISTORY_LIMIT);
      await existing.save();
    } else {
      try {
        await ConsultationRecord.create({
          appointmentId: appointment._id,
          patientId: String(appointment.patientId),
          doctorId: String(appointment.doctorId),
          ...values,
          createdBy: user.id,
          updatedBy: user.id,
          changeHistory: [],
        });
      } catch (error) {
        const duplicate =
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          (error as { code?: unknown }).code === 11000;
        if (duplicate) {
          return errorResponse(
            409,
            "A consultation record already exists for this appointment. Reload and try again.",
          );
        }
        throw error;
      }
    }

    const populated = await ConsultationRecord.findOne({
      appointmentId: appointment._id,
    })
      .populate("appointmentId", APPOINTMENT_POPULATE)
      .populate("patientId", "name")
      .populate("doctorId", "name specialization")
      .populate("createdBy", "name")
      .populate("updatedBy", "name")
      .lean();

    if (!populated) {
      return errorResponse(503, "Unable to save the consultation record.");
    }

    return itemResponse(
      toConsultationRecordDto(populated, { includeHistory: true }),
    );
  } catch (error) {
    logApiFailure("appointments/consultation/save", error);
    return errorResponse(
      503,
      "Unable to save the consultation record right now. Please try again.",
    );
  }
}
