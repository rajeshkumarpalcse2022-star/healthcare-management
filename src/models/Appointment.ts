import { Schema, type HydratedDocument, type Types } from "mongoose";

import {
  APPOINTMENT_REASON_MAX_LENGTH,
  APPOINTMENT_STATUSES,
  APPOINTMENT_TYPES,
  MEETING_PROVIDERS,
  type MeetingProvider,
} from "@/config/appointments";
import { getModel } from "@/lib/db";

/**
 * Appointment model - one requested doctor consultation.
 *
 * Identity: `patientId` references the authenticated PATIENT-role user that
 * owns the appointment; `doctorId` references the Doctor *profile* (which
 * itself links to a login account through `Doctor.userId`). The clinic comes
 * from the doctor's primary clinic at booking time and is stored so existing
 * appointments remain readable even if the doctor later moves clinics.
 *
 * Time: `appointmentDate` stores UTC midnight of the calendar date;
 * `timeSlot` is the slot START in the doctor's timezone captured at booking
 * (`timezone` freezes that zone), and `endTime` is precomputed for display.
 * Changing a doctor's schedule later never rewrites stored appointments.
 *
 * Lifecycle: `PENDING -> CONFIRMED -> IN_PROGRESS -> COMPLETED` plus
 * `CANCELLED` / `REJECTED` - enforced by the transition table in
 * `@/config/appointments`, never by client input alone. Cancelled and
 * rejected attempts keep their history row forever.
 *
 * Money: nothing here records payment state. `consultationFee` lives on the
 * Doctor profile as an informational display value only.
 */
export interface AppointmentRecord {
  /** Unique reference shown to patients and staff, e.g. `APT-2026-000001`. */
  appointmentCode: string;
  /** Owning patient (PATIENT-role User). Resolved server-side from session. */
  patientId: Types.ObjectId;
  doctorId: Types.ObjectId;
  clinicId: Types.ObjectId;
  /** Scheduled calendar date (UTC midnight of that date, doctor-local meaning). */
  appointmentDate: Date;
  /** Slot start in the doctor's timezone, `HH:mm`. */
  timeSlot: string;
  /** Precomputed slot end, `HH:mm`. */
  endTime: string;
  /** Doctor timezone captured at booking time. */
  timezone: string;
  appointmentType: (typeof APPOINTMENT_TYPES)[number];
  /**
   * Online consultation join URL. Created automatically when an ONLINE
   * appointment is confirmed; `null` for clinic visits and unconfirmed
   * online requests.
   */
  meetingLink: string | null;
  meetingProvider: MeetingProvider | null;
  meetingCreatedAt: Date | null;
  status: (typeof APPOINTMENT_STATUSES)[number];
  /** Optional free-text reason for the visit, supplied by the patient. */
  reason: string | null;
  cancellationReason: string | null;
  cancelledAt: Date | null;
  /** Confirmer / rejecter (owning doctor or admin). */
  reviewedBy: Types.ObjectId | null;
  reviewedAt: Date | null;
  /** Required when the doctor rejects a pending request. */
  rejectionReason: string | null;
  startedBy: Types.ObjectId | null;
  startedAt: Date | null;
  completedBy: Types.ObjectId | null;
  completedAt: Date | null;
  /** User who created the appointment (the patient, or admin on their behalf). */
  createdBy: Types.ObjectId;
  /** Optional client-supplied key that makes retried submissions idempotent. */
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const appointmentSchema = new Schema<AppointmentRecord>(
  {
    appointmentCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      maxlength: 32,
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
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
    },
    appointmentDate: {
      type: Date,
      required: true,
    },
    timeSlot: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):[0-5]\d$/,
    },
    endTime: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):[0-5]\d$/,
    },
    timezone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
    },
    appointmentType: {
      type: String,
      enum: [...APPOINTMENT_TYPES],
      required: true,
      default: "CLINIC_VISIT",
    },
    meetingLink: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    meetingProvider: {
      type: String,
      enum: [...MEETING_PROVIDERS],
      default: null,
    },
    meetingCreatedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: [...APPOINTMENT_STATUSES],
      required: true,
      default: "PENDING",
    },
    reason: {
      type: String,
      trim: true,
      maxlength: APPOINTMENT_REASON_MAX_LENGTH,
      default: null,
      set: cleanText,
    },
    cancellationReason: {
      type: String,
      trim: true,
      maxlength: APPOINTMENT_REASON_MAX_LENGTH,
      default: null,
      set: cleanText,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: APPOINTMENT_REASON_MAX_LENGTH,
      default: null,
      set: cleanText,
    },
    startedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    completedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

/**
 * Indexes: `appointmentCode` uniqueness comes from the field definition
 * above. `idempotencyKey` gets a *partial* unique index - only real strings
 * are indexed, so the `null` stored for appointments submitted without a key
 * can never collide. The rest cover the patient history view, the doctor's
 * date/status/type filters and management monitoring.
 */
appointmentSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } },
);
appointmentSchema.index({ patientId: 1, createdAt: -1 });
appointmentSchema.index({ doctorId: 1, appointmentDate: 1 });
appointmentSchema.index({ doctorId: 1, status: 1, appointmentDate: 1 });
appointmentSchema.index({ status: 1, appointmentDate: 1 });
appointmentSchema.index({ appointmentType: 1, appointmentDate: 1 });
appointmentSchema.index({ createdAt: -1 });

export type AppointmentDocument = HydratedDocument<AppointmentRecord>;

/** Registered through the `getModel` helper (HMR-idempotent). */
export const Appointment = getModel<AppointmentRecord>(
  "Appointment",
  appointmentSchema,
);
