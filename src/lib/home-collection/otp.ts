import "server-only";

import { createHash, randomInt, timingSafeEqual } from "node:crypto";

import {
  COLLECTION_OTP_LENGTH,
  COLLECTION_OTP_TTL_MINUTES,
} from "@/config/home-collection";

/**
 * Cryptographically secure pickup OTP helpers (STEP 8 workflow).
 *
 * Only the SHA-256 hash of an OTP is ever persisted. The plaintext is
 * returned exactly once to the authenticated patient when the request is
 * created and is never logged, never stored and never exposed through list
 * or detail APIs. Verification compares hashes with a timing-safe equality
 * so response time cannot leak prefix matches.
 *
 * No secret pepper is mixed in: an OTP is short-lived (15 minutes) and
 * rate-limited by attempt count, so plain SHA-256 of the 6-digit value is
 * sufficient and keeps verification usable inside atomic update filters.
 */

/** Generates a cryptographically secure numeric OTP (e.g. "048291"). */
export function generateCollectionOtp(): string {
  return randomInt(0, 10 ** COLLECTION_OTP_LENGTH)
    .toString()
    .padStart(COLLECTION_OTP_LENGTH, "0");
}

/** SHA-256 hash of an OTP - the only representation ever stored. */
export function hashCollectionOtp(otp: string): string {
  return createHash("sha256").update(otp, "utf8").digest("hex");
}

/** Timing-safe comparison of a submitted OTP against the stored hash. */
export function verifyCollectionOtp(otp: string, storedHash: string): boolean {
  if (!otp || !storedHash) return false;
  const candidate = Buffer.from(hashCollectionOtp(otp), "utf8");
  const expected = Buffer.from(storedHash, "utf8");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

/** Expiry timestamp for a freshly generated OTP (short-lived default). */
export function collectionOtpExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + COLLECTION_OTP_TTL_MINUTES * 60_000);
}

/**
 * Pickup-aware OTP expiry: valid through the whole scheduled pickup day.
 *
 * `scheduledDate` is UTC midnight of the pickup date; adding 36 hours covers
 * the end of that calendar day in every timezone (UTC-12 through UTC+14),
 * so a collector verifying during the visit never hits a premature 410. The
 * 15-minute TTL is kept as a floor for same-day/last-minute requests.
 */
export function collectionOtpExpiryForPickup(
  scheduledDate: Date,
  from: Date = new Date(),
): Date {
  const dayEnd = scheduledDate.getTime() + 36 * 60 * 60 * 1000;
  return new Date(
    Math.max(dayEnd, from.getTime() + COLLECTION_OTP_TTL_MINUTES * 60_000),
  );
}
