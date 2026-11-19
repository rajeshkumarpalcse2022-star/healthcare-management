import "server-only";

import { createHash, randomInt, timingSafeEqual } from "crypto";

import { OtpCode } from "@/models/OtpCode";

/**
 * OTP generation, hashing and verification for patient signup.
 *
 * - 6-digit numeric code, cryptographically random.
 * - Stored only as a SHA-256 hash - a database leak never exposes live codes.
 * - Single active code per email+purpose (a resend replaces the previous one).
 * - Constant-time comparison via `crypto.timingSafeEqual`.
 * - 10-minute expiry; max 5 verification attempts per code.
 */

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 10 * 60;
export const OTP_MAX_ATTEMPTS = 5;
/** Minimum gap between OTP sends for the same email (resend throttle). */
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

export type OtpPurpose = "PATIENT_SIGNUP";

export function hashOtp(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Generates a cryptographically random 6-digit code, zero-padded. */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000)
    .toString()
    .padStart(OTP_LENGTH, "0");
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface CreateOtpResult {
  ok: boolean;
  code?: string;
  /** Seconds the caller must wait before the next send (throttle). */
  retryAfterSeconds?: number;
}

/**
 * Creates (or replaces) the active OTP for an email. Returns the plain code
 * exactly once so the caller can email it; it is never retrievable again.
 */
export async function createOtp(
  email: string,
  purpose: OtpPurpose,
): Promise<CreateOtpResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const now = new Date();

  const existing = await OtpCode.findOne({
    email: normalizedEmail,
    purpose,
  }).lean();

  if (existing) {
    const elapsedSeconds = Math.floor(
      (now.getTime() - new Date(existing.updatedAt).getTime()) / 1000,
    );
    if (elapsedSeconds < OTP_RESEND_COOLDOWN_SECONDS) {
      return {
        ok: false,
        retryAfterSeconds: OTP_RESEND_COOLDOWN_SECONDS - elapsedSeconds,
      };
    }
  }

  const code = generateOtpCode();
  const expiresAt = new Date(now.getTime() + OTP_TTL_SECONDS * 1000);

  // Upsert: a resend always replaces the previous live code for this email.
  await OtpCode.findOneAndUpdate(
    { email: normalizedEmail, purpose },
    {
      $set: {
        codeHash: hashOtp(code),
        expiresAt,
        attempts: 0,
      },
      $setOnInsert: {
        email: normalizedEmail,
        purpose,
      },
    },
    { upsert: true, new: true },
  );

  return { ok: true, code };
}

export type OtpVerifyFailure =
  | "NOT_FOUND"
  | "EXPIRED"
  | "INVALID"
  | "TOO_MANY_ATTEMPTS";

export type OtpVerifyResult =
  | { ok: true; email: string }
  | { ok: false; reason: OtpVerifyFailure };

/**
 * Verifies a submitted OTP against the stored hash.
 *
 * On success the OTP document is deleted (single-use). On a wrong code the
 * attempt counter is bumped; after `OTP_MAX_ATTEMPTS` the code is burned.
 */
export async function verifyOtp(
  email: string,
  code: string,
  purpose: OtpPurpose,
): Promise<OtpVerifyResult> {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedCode = code.trim();

  const record = await OtpCode.findOne({
    email: normalizedEmail,
    purpose,
  });

  if (!record) return { ok: false, reason: "NOT_FOUND" };

  if (record.expiresAt.getTime() <= Date.now()) {
    await OtpCode.deleteOne({ _id: record._id });
    return { ok: false, reason: "EXPIRED" };
  }

  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await OtpCode.deleteOne({ _id: record._id });
    return { ok: false, reason: "TOO_MANY_ATTEMPTS" };
  }

  const expected = record.codeHash;
  const submitted = hashOtp(normalizedCode);

  if (!constantTimeEquals(submitted, expected)) {
    await OtpCode.updateOne(
      { _id: record._id },
      { $inc: { attempts: 1 } },
    );
    return { ok: false, reason: "INVALID" };
  }

  await OtpCode.deleteOne({ _id: record._id });
  return { ok: true, email: normalizedEmail };
}

/** Deletes any live OTP for an email (used after successful signup). */
export async function clearOtp(
  email: string,
  purpose: OtpPurpose,
): Promise<void> {
  await OtpCode.deleteMany({
    email: email.trim().toLowerCase(),
    purpose,
  });
}
