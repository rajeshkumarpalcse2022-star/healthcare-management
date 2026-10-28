import { Schema, type HydratedDocument, type Types } from "mongoose";

import { getModel } from "@/lib/db";
import {
  PATIENT_BLOOD_GROUPS,
  PATIENT_GENDERS,
  PATIENT_NOTES_MAX_LENGTH,
} from "@/config/patients";

/**
 * PatientProfile model - clinical demographics for a PATIENT-role account.
 *
 * Identity split (P1-1 design): `name`, `email` and `phone` live ONLY on the
 * User document; this model never duplicates them. The profile is the single
 * 1:1 companion row that carries what a laboratory actually needs at the
 * counter - date of birth, gender, blood group, address, emergency contact -
 * plus staff-only clinical notes.
 *
 * Absent profile (legacy accounts): every PATIENT that signed up before this
 * module simply has no row here. Read endpoints synthesize an empty profile
 * from the session/user identity WITHOUT writing; the first staff PATCH or
 * patient self-PUT upserts the real row. No backfill migration is required.
 *
 * Two independent switches:
 * - `User.isActive` gates login (managed via /api/users, SA/ADMIN only);
 * - `isActive` here gates the patient RECORD - deactivated profiles are
 *   hidden from pickers and cannot create new bookings or collections, while
 *   existing history stays intact.
 */
export interface PatientAddress {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  pincode: string;
}

export interface PatientEmergencyContact {
  name: string;
  phone: string;
  relationship: string | null;
}

export interface PatientProfileRecord {
  /** PATIENT-role User that owns this profile. One profile per account. */
  userId: Types.ObjectId;
  dateOfBirth: Date | null;
  gender: (typeof PATIENT_GENDERS)[number] | null;
  bloodGroup: (typeof PATIENT_BLOOD_GROUPS)[number] | null;
  address: PatientAddress | null;
  emergencyContact: PatientEmergencyContact | null;
  /** Staff-only clinical remarks - never returned on patient self-views. */
  notes: string | null;
  /** Record-level deactivate (distinct from login-blocking `User.isActive`). */
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const addressSchema = new Schema<PatientAddress>(
  {
    line1: { type: String, required: true, trim: true, maxlength: 160 },
    line2: {
      type: String,
      trim: true,
      maxlength: 160,
      default: null,
      set: cleanText,
    },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    state: { type: String, required: true, trim: true, maxlength: 80 },
    pincode: { type: String, required: true, trim: true, maxlength: 12 },
  },
  { _id: false },
);

const emergencyContactSchema = new Schema<PatientEmergencyContact>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    relationship: {
      type: String,
      trim: true,
      maxlength: 40,
      default: null,
      set: cleanText,
    },
  },
  { _id: false },
);

const patientProfileSchema = new Schema<PatientProfileRecord>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    dateOfBirth: {
      type: Date,
      default: null,
    },
    gender: {
      type: String,
      enum: [...PATIENT_GENDERS],
      default: null,
    },
    bloodGroup: {
      type: String,
      enum: [...PATIENT_BLOOD_GROUPS],
      default: null,
    },
    address: {
      type: addressSchema,
      default: null,
    },
    emergencyContact: {
      type: emergencyContactSchema,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: PATIENT_NOTES_MAX_LENGTH,
      default: null,
      set: cleanText,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

/**
 * Indexes: `userId` uniqueness comes from the field definition above. The
 * rest cover the staff directory filters (record status, recency).
 */
patientProfileSchema.index({ isActive: 1 });
patientProfileSchema.index({ createdAt: -1 });

export type PatientProfileDocument = HydratedDocument<PatientProfileRecord>;

/** Registered through the `getModel` helper (HMR-idempotent). */
export const PatientProfile = getModel<PatientProfileRecord>(
  "PatientProfile",
  patientProfileSchema,
);
