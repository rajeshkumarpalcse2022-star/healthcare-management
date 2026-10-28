import { Schema, type HydratedDocument } from "mongoose";

import { getModel } from "@/lib/db";

/**
 * Clinic model - a physical / organisational care site.
 *
 * Denormalised contact and address fields are stored directly on the clinic
 * (they are the clinic's own data, not a copy of another entity). Doctors
 * reference clinics by ObjectId; clinic names are never duplicated onto
 * Doctor records.
 */
export interface ClinicRecord {
  name: string;
  /** Business code, stored normalised (uppercase, hyphenated). */
  code: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  registrationNumber: string | null;
  imageUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Shared normalisation applied to user-supplied text fields. */
function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const clinicSchema = new Schema<ClinicRecord>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 32,
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 20,
      default: null,
      set: cleanText,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      maxlength: 254,
      default: null,
      set: cleanText,
    },
    address: {
      type: String,
      trim: true,
      maxlength: 240,
      default: null,
      set: cleanText,
    },
    city: {
      type: String,
      trim: true,
      maxlength: 80,
      default: null,
      set: cleanText,
    },
    state: {
      type: String,
      trim: true,
      maxlength: 80,
      default: null,
      set: cleanText,
    },
    pincode: {
      type: String,
      trim: true,
      maxlength: 12,
      default: null,
      set: cleanText,
    },
    registrationNumber: {
      type: String,
      trim: true,
      maxlength: 64,
      default: null,
      set: cleanText,
    },
    imageUrl: {
      type: String,
      trim: true,
      maxlength: 800,
      default: null,
      set: cleanText,
    },
    latitude: {
      type: Number,
      min: -90,
      max: 90,
      default: null,
    },
    longitude: {
      type: Number,
      min: -180,
      max: 180,
      default: null,
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
 * Indexes: `code` is unique via the field definition above. Additional
 * indexes cover directory search and the status filter.
 */
clinicSchema.index({ name: 1 });
clinicSchema.index({ city: 1 });
clinicSchema.index({ isActive: 1 });
clinicSchema.index({ createdAt: -1 });

export type ClinicDocument = HydratedDocument<ClinicRecord>;

/** Registered through the `getModel` helper (HMR-idempotent). */
export const Clinic = getModel<ClinicRecord>("Clinic", clinicSchema);
