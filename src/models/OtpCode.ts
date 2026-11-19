import { Schema, type HydratedDocument } from "mongoose";

import { getModel } from "@/lib/db";

/**
 * OtpCode model - short-lived email verification codes for patient signup.
 *
 * Only the hash of the OTP is stored (never the plain code). Each document
 * is single-use: successful verification deletes it. Expired documents are
 * cleaned up opportunistically on new sends for the same email and by a TTL
 * index as a backstop.
 */

export interface OtpCodeRecord {
  email: string;
  /** SHA-256 hex of the 6-digit code - the plain code is never persisted. */
  codeHash: string;
  purpose: "PATIENT_SIGNUP";
  expiresAt: Date;
  /** How many send attempts for this email (resend throttling). */
  attempts: number;
  createdAt: Date;
  updatedAt: Date;
}

const otpCodeSchema = new Schema<OtpCodeRecord>(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    codeHash: {
      type: String,
      required: true,
    },
    purpose: {
      type: String,
      enum: ["PATIENT_SIGNUP"],
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    attempts: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  },
);

// One live OTP per email+purpose; a new send replaces the previous code.
otpCodeSchema.index({ email: 1, purpose: 1 }, { unique: true });

// Backstop cleanup - MongoDB removes the document once expiresAt passes.
otpCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export type OtpCodeDocument = HydratedDocument<OtpCodeRecord>;

/** Registered through the STEP 2 `getModel` helper (HMR-idempotent). */
export const OtpCode = getModel<OtpCodeRecord>("OtpCode", otpCodeSchema);
