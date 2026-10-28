import { Schema, type HydratedDocument, type Types } from "mongoose";

import { getModel } from "@/lib/db";
import {
  BOOKING_STATUSES,
  BOOKING_NOTE_MAX_LENGTH,
} from "@/config/lab-bookings";

/**
 * LabBooking model - one online lab-test booking.
 *
 * Identity: `patientId` references the authenticated PATIENT-role user
 * account that owns the booking. The platform's Patient Management module
 * ships in a later step; until then the PATIENT user IS the patient record,
 * and this reference can be migrated to a dedicated Patient document without
 * touching booking history (snapshots below carry what operations need).
 *
 * Snapshot policy: each item copies the booked test's code, name and price at
 * booking time, and `patientContactSnapshot` copies the patient's contact
 * details. Historical bookings therefore keep rendering correctly even if the
 * catalogue or the patient profile changes later. Snapshots stay limited to
 * what booking history and operational continuity need - no full patient or
 * laboratory document is duplicated.
 *
 * Money: `totalAmount` is computed exclusively on the server from trusted
 * LabTest records. Booking and payment are separate concepts - nothing here
 * records payment state.
 */
export interface LabBookingItemSnapshot {
  labTestId: Types.ObjectId;
  /** Business code at booking time. */
  testCode: string;
  /** Display name at booking time. */
  testName: string;
  /** Catalogue price at booking time. */
  price: number;
}

export interface LabBookingContactSnapshot {
  name: string;
  email: string | null;
  phone: string | null;
}

export interface LabBookingRecord {
  /** Unique reference shown to patients and staff, e.g. `LAB-2026-000001`. */
  bookingCode: string;
  /** Owning patient (PATIENT-role User). Resolved server-side from session. */
  patientId: Types.ObjectId;
  laboratoryId: Types.ObjectId;
  items: LabBookingItemSnapshot[];
  /** Scheduled calendar date (UTC midnight of that date, lab-local meaning). */
  bookingDate: Date;
  /** Slot start in the laboratory timezone, `HH:mm`. */
  timeSlot: string;
  /** Laboratory timezone captured at booking time. */
  timezone: string;
  patientContactSnapshot: LabBookingContactSnapshot;
  status: (typeof BOOKING_STATUSES)[number];
  /** Server-calculated sum of item prices at booking time. */
  totalAmount: number;
  notes: string | null;
  cancellationReason: string | null;
  cancelledAt: Date | null;
  /** Lab manager (or above) who approved or rejected the request. */
  reviewedBy: Types.ObjectId | null;
  reviewedAt: Date | null;
  /** Required when the request is rejected by the review queue. */
  rejectionReason: string | null;
  /** User who created the booking (the patient, or staff on their behalf). */
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

const itemSnapshotSchema = new Schema<LabBookingItemSnapshot>(
  {
    labTestId: {
      type: Schema.Types.ObjectId,
      ref: "LabTest",
      required: true,
    },
    testCode: {
      type: String,
      required: true,
      trim: true,
      maxlength: 32,
    },
    testName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false },
);

const contactSnapshotSchema = new Schema<LabBookingContactSnapshot>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      maxlength: 254,
      default: null,
      set: cleanText,
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 20,
      default: null,
      set: cleanText,
    },
  },
  { _id: false },
);

const labBookingSchema = new Schema<LabBookingRecord>(
  {
    bookingCode: {
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
    laboratoryId: {
      type: Schema.Types.ObjectId,
      ref: "Laboratory",
      required: true,
    },
    items: {
      type: [itemSnapshotSchema],
      required: true,
      validate: {
        validator: (value: LabBookingItemSnapshot[]) =>
          Array.isArray(value) && value.length > 0 && value.length <= 20,
        message: "A booking must contain between 1 and 20 tests.",
      },
    },
    bookingDate: {
      type: Date,
      required: true,
    },
    timeSlot: {
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
    patientContactSnapshot: {
      type: contactSnapshotSchema,
      required: true,
    },
    status: {
      type: String,
      enum: [...BOOKING_STATUSES],
      required: true,
      default: "PENDING",
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: BOOKING_NOTE_MAX_LENGTH,
      default: null,
      set: cleanText,
    },
    cancellationReason: {
      type: String,
      trim: true,
      maxlength: BOOKING_NOTE_MAX_LENGTH,
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
      maxlength: BOOKING_NOTE_MAX_LENGTH,
      default: null,
      set: cleanText,
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
 * Indexes: `bookingCode` uniqueness comes from the field definition above.
 * `idempotencyKey` gets a *partial* unique index - only real strings are
 * indexed, so the `null` stored for bookings submitted without a key can
 * never collide with another booking (a plain unique or sparse index would).
 * The rest cover the patient history view, the management list filters, the
 * per-laboratory operational view and test lookups.
 */
labBookingSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } },
);
labBookingSchema.index({ patientId: 1, createdAt: -1 });
labBookingSchema.index({ laboratoryId: 1, bookingDate: 1 });
labBookingSchema.index({ status: 1, bookingDate: 1 });
labBookingSchema.index({ status: 1, createdAt: -1 });
labBookingSchema.index({ "items.labTestId": 1 });
labBookingSchema.index({ createdAt: -1 });

export type LabBookingDocument = HydratedDocument<LabBookingRecord>;

/** Registered through the `getModel` helper (HMR-idempotent). */
export const LabBooking = getModel<LabBookingRecord>(
  "LabBooking",
  labBookingSchema,
);
