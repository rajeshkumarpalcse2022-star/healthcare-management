import { Schema, type HydratedDocument, type Types } from "mongoose";

import {
  CONSULTATION_CHANGE_HISTORY_LIMIT,
  CONSULTATION_DIAGNOSIS_MAX_LENGTH,
  CONSULTATION_FOLLOW_UP_MAX_LENGTH,
  CONSULTATION_NOTES_MAX_LENGTH,
  CONSULTATION_TREATMENT_MAX_LENGTH,
  MAX_CONSULTATION_ATTACHMENTS,
  MAX_PRESCRIPTION_ITEMS,
  PRESCRIPTION_DOSAGE_MAX_LENGTH,
  PRESCRIPTION_DURATION_MAX_LENGTH,
  PRESCRIPTION_FREQUENCY_MAX_LENGTH,
  PRESCRIPTION_INSTRUCTIONS_MAX_LENGTH,
  PRESCRIPTION_MEDICINE_MAX_LENGTH,
} from "@/config/appointments";
import { getModel } from "@/lib/db";

/**
 * ConsultationRecord - the clinical record of one completed (or in-progress)
 * doctor consultation, including its prescription items.
 *
 * One record per appointment (unique `appointmentId`): the doctor writes it
 * while the appointment is `IN_PROGRESS` and it becomes the patient's
 * medical record once the appointment is `COMPLETED`. This module never
 * generates medical advice itself - the record only stores what the
 * authorized clinician entered.
 *
 * Access: the owning doctor creates/updates it for their own appointments;
 * the patient reads their own record only once the appointment is completed
 * (released). Other doctors and administrative roles have no clinical-note
 * access through this API.
 *
 * Audit: every update appends a capped `changeHistory` entry with the actor
 * and the field names that changed (mirrors the `User.laboratoryScopeHistory`
 * precedent) - important clinical-record changes are traceable without a
 * second collection.
 */
export interface PrescriptionItemRecord {
  medicine: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string | null;
}

export interface ConsultationAttachmentRecord {
  fileName: string;
  url: string;
  mimeType: string;
  size: number;
  uploadedAt: Date;
  uploadedBy: Types.ObjectId;
}

export interface ConsultationChangeEntryRecord {
  changedBy: Types.ObjectId;
  changedAt: Date;
  changedFields: string[];
}

export interface ConsultationRecordRecord {
  /** One consultation record per appointment. */
  appointmentId: Types.ObjectId;
  patientId: Types.ObjectId;
  doctorId: Types.ObjectId;
  notes: string | null;
  diagnosis: string | null;
  treatmentAdvice: string | null;
  followUp: string | null;
  prescriptionItems: PrescriptionItemRecord[];
  attachments: ConsultationAttachmentRecord[];
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  changeHistory: ConsultationChangeEntryRecord[];
  createdAt: Date;
  updatedAt: Date;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const prescriptionItemSchema = new Schema<PrescriptionItemRecord>(
  {
    medicine: {
      type: String,
      required: true,
      trim: true,
      maxlength: PRESCRIPTION_MEDICINE_MAX_LENGTH,
    },
    dosage: {
      type: String,
      required: true,
      trim: true,
      maxlength: PRESCRIPTION_DOSAGE_MAX_LENGTH,
    },
    frequency: {
      type: String,
      required: true,
      trim: true,
      maxlength: PRESCRIPTION_FREQUENCY_MAX_LENGTH,
    },
    duration: {
      type: String,
      required: true,
      trim: true,
      maxlength: PRESCRIPTION_DURATION_MAX_LENGTH,
    },
    instructions: {
      type: String,
      trim: true,
      maxlength: PRESCRIPTION_INSTRUCTIONS_MAX_LENGTH,
      default: null,
      set: cleanText,
    },
  },
  { _id: false },
);

const consultationAttachmentSchema = new Schema<ConsultationAttachmentRecord>(
  {
    fileName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    url: {
      type: String,
      required: true,
      trim: true,
      maxlength: 800,
    },
    mimeType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    size: {
      type: Number,
      required: true,
      min: 1,
    },
    uploadedAt: {
      type: Date,
      required: true,
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { _id: false },
);

const changeEntrySchema = new Schema<ConsultationChangeEntryRecord>(
  {
    changedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    changedAt: {
      type: Date,
      required: true,
    },
    changedFields: {
      type: [String],
      required: true,
    },
  },
  { _id: false },
);

const consultationRecordSchema = new Schema<ConsultationRecordRecord>(
  {
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
      unique: true,
    },
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: CONSULTATION_NOTES_MAX_LENGTH,
      default: null,
      set: cleanText,
    },
    diagnosis: {
      type: String,
      trim: true,
      maxlength: CONSULTATION_DIAGNOSIS_MAX_LENGTH,
      default: null,
      set: cleanText,
    },
    treatmentAdvice: {
      type: String,
      trim: true,
      maxlength: CONSULTATION_TREATMENT_MAX_LENGTH,
      default: null,
      set: cleanText,
    },
    followUp: {
      type: String,
      trim: true,
      maxlength: CONSULTATION_FOLLOW_UP_MAX_LENGTH,
      default: null,
      set: cleanText,
    },
    prescriptionItems: {
      type: [prescriptionItemSchema],
      default: [],
      validate: {
        validator: (value: PrescriptionItemRecord[]) =>
          Array.isArray(value) && value.length <= MAX_PRESCRIPTION_ITEMS,
        message: `A prescription can contain at most ${MAX_PRESCRIPTION_ITEMS} items.`,
      },
    },
    attachments: {
      type: [consultationAttachmentSchema],
      default: [],
      validate: {
        validator: (value: ConsultationAttachmentRecord[]) =>
          Array.isArray(value) && value.length <= MAX_CONSULTATION_ATTACHMENTS,
        message: `A record can contain at most ${MAX_CONSULTATION_ATTACHMENTS} attached files.`,
      },
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    changeHistory: {
      type: [changeEntrySchema],
      default: [],
      validate: {
        validator: (value: ConsultationChangeEntryRecord[]) =>
          Array.isArray(value) && value.length <= CONSULTATION_CHANGE_HISTORY_LIMIT,
        message: "Consultation change history is over its retention limit.",
      },
    },
  },
  {
    timestamps: true,
  },
);

/** List lookups for the patient's records and the doctor's records. */
consultationRecordSchema.index({ patientId: 1, updatedAt: -1 });
consultationRecordSchema.index({ doctorId: 1, updatedAt: -1 });

export type ConsultationRecordDocument =
  HydratedDocument<ConsultationRecordRecord>;

/** Registered through the `getModel` helper (HMR-idempotent). */
export const ConsultationRecord = getModel<ConsultationRecordRecord>(
  "ConsultationRecord",
  consultationRecordSchema,
);
