/**
 * STEP 10 smoke test - OTP helpers, status transitions, validation schemas.
 * Run: node --conditions=react-server --experimental-strip-types --import ./scripts/step8/register.mjs scripts/step10-smoke.mjs
 */
import assert from "node:assert/strict";

import {
  COLLECTION_STATUSES,
  COLLECTION_OTP_PATTERN,
  COLLECTION_OTP_LENGTH,
  COLLECTION_OTP_TTL_MINUTES,
  COLLECTION_OTP_MAX_ATTEMPTS,
  canTransitionCollectionStatus,
} from "../src/config/home-collection.ts";
import {
  generateCollectionOtp,
  hashCollectionOtp,
  verifyCollectionOtp,
  collectionOtpExpiry,
} from "../src/lib/home-collection/otp.ts";
import {
  homeCollectionRejectSchema,
  homeCollectionVerifyOtpSchema,
  homeCollectionStatusSchema,
} from "../src/lib/validation/home-collection.ts";

/* ---- statuses ---- */
assert.ok(COLLECTION_STATUSES.includes("REJECTED"));
assert.ok(COLLECTION_STATUSES.includes("COLLECTOR_ACCEPTED"));
assert.equal(COLLECTION_STATUSES.length, 10);

/* ---- transitions ---- */
assert.ok(canTransitionCollectionStatus("PENDING", "REJECTED"));
assert.ok(canTransitionCollectionStatus("PENDING", "CONFIRMED"));
assert.ok(canTransitionCollectionStatus("ASSIGNED", "COLLECTOR_ACCEPTED"));
assert.ok(canTransitionCollectionStatus("COLLECTOR_ACCEPTED", "COLLECTOR_EN_ROUTE"));
assert.ok(canTransitionCollectionStatus("COLLECTOR_EN_ROUTE", "ARRIVED"));
assert.ok(canTransitionCollectionStatus("ARRIVED", "COLLECTED"));
assert.ok(!canTransitionCollectionStatus("COLLECTED", "FAILED"));
assert.ok(!canTransitionCollectionStatus("REJECTED", "CONFIRMED"));
assert.ok(!canTransitionCollectionStatus("CANCELLED", "PENDING"));

/* ---- OTP helpers ---- */
const otp = generateCollectionOtp();
assert.equal(otp.length, COLLECTION_OTP_LENGTH);
assert.ok(COLLECTION_OTP_PATTERN.test(otp), `generated OTP ${otp} must match pattern`);

const hash = hashCollectionOtp(otp);
assert.equal(hash.length, 64, "sha256 hex digest is 64 chars");
assert.ok(verifyCollectionOtp(otp, hash));
assert.ok(!verifyCollectionOtp("000000" === otp ? "111111" : "000000", hash));
assert.ok(!verifyCollectionOtp(otp, hash.slice(0, -1)), "length mismatch must fail");

const expiry = collectionOtpExpiry();
const diffMs = expiry.getTime() - Date.now();
assert.ok(diffMs > COLLECTION_OTP_TTL_MINUTES * 60_000 - 5_000);
assert.ok(diffMs <= COLLECTION_OTP_TTL_MINUTES * 60_000);

assert.equal(COLLECTION_OTP_MAX_ATTEMPTS, 5);

/* ---- validation schemas ---- */
const rejectOk = homeCollectionRejectSchema.safeParse({
  reason: "Outside serviceable pincode",
});
assert.ok(rejectOk.success);

const rejectShort = homeCollectionRejectSchema.safeParse({ reason: "ab" });
assert.ok(!rejectShort.success, "reject reason < 3 chars must fail");

const otpOk = homeCollectionVerifyOtpSchema.safeParse({ otp });
assert.ok(otpOk.success);

const otpBad = homeCollectionVerifyOtpSchema.safeParse({ otp: "12345" });
assert.ok(!otpBad.success, "5-digit OTP must fail");

const statusReject = homeCollectionStatusSchema.safeParse({
  status: "COLLECTOR_ACCEPTED",
});
assert.ok(statusReject.success);

const statusCancelled = homeCollectionStatusSchema.safeParse({
  status: "CANCELLED",
});
assert.ok(!statusCancelled.success, "CANCELLED is not allowed via status endpoint");

const statusFailedNoReason = homeCollectionStatusSchema.safeParse({
  status: "FAILED",
});
assert.ok(!statusFailedNoReason.success, "FAILED without reason must fail");

console.log("STEP 10 smoke: all assertions passed.");
