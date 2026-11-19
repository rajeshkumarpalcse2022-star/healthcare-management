import { NextResponse } from "next/server";
import { z } from "zod";

import {
  hashPassword,
  setSessionCookie,
  toSafeUser,
} from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { isDuplicateKeyError, logApiFailure } from "@/lib/api/response";
import { clearOtp, verifyOtp } from "@/lib/otp";
import { User } from "@/models/User";
import {
  generateUniqueId,
  uniqueIdPrefixForRole,
} from "@/lib/unique-id";
import {
  registerSchema,
  normalizeEmail,
  toFieldIssues,
} from "@/lib/validation/auth";
import type {
  AuthErrorBody,
  OtpVerifySuccessBody,
} from "@/types/auth";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

const MAX_UNIQUE_ID_ATTEMPTS = 5;

/** Registration payload plus the emailed OTP. */
const otpVerifySchema = registerSchema.extend({
  otp: z.string("Verification code is required.").min(1, "Verification code is required."),
});

function errorResponse(
  status: number,
  error: string,
  issues?: AuthErrorBody["issues"],
): NextResponse {
  return NextResponse.json<AuthErrorBody>(
    { success: false, error, ...(issues ? { issues } : {}) },
    { status, headers: NO_STORE },
  );
}

/**
 * POST /api/auth/otp/verify
 *
 * Final step of patient self-registration: verifies the emailed OTP, then
 * creates the PATIENT account (with a fresh unique ID) and issues the
 * session cookie. The OTP is single-use and deleted on success.
 *
 * Accepts the same registration payload as `/api/auth/register` plus `otp`.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = otpVerifySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const { name, password, role, otp: otpCode } = parsed.data;
  const email = normalizeEmail(parsed.data.email);
  const phone = parsed.data.phone?.trim() || null;
  if (!/^\d{6}$/.test(otpCode)) {
    return errorResponse(400, "Enter the 6-digit verification code.", [
      { field: "otp", message: "Enter the 6-digit verification code." },
    ]);
  }

  // Patients only - doctors and labs are provisioned by administrators.
  if (role !== "PATIENT") {
    return errorResponse(400, "Only patients can create an account.");
  }

  try {
    await connectToDatabase();

    const otpResult = await verifyOtp(email, otpCode, "PATIENT_SIGNUP");
    if (!otpResult.ok) {
      const message =
        otpResult.reason === "EXPIRED"
          ? "That code has expired. Request a new one."
          : otpResult.reason === "TOO_MANY_ATTEMPTS"
            ? "Too many incorrect attempts. Request a new code."
            : otpResult.reason === "NOT_FOUND"
              ? "No pending verification for this email. Request a new code."
              : "That code is incorrect. Try again.";
      return errorResponse(400, message, [
        { field: "otp", message },
      ]);
    }

    // Re-check email availability (race with a concurrent signup).
    const existing = await User.findOne({ email }).select("_id").lean();
    if (existing) {
      return errorResponse(
        409,
        "An account with this email already exists. Sign in instead.",
      );
    }

    const passwordHash = await hashPassword(password);

    // Allocate a unique PATIENT ID, retrying on the unlikely collision.
    const kind = uniqueIdPrefixForRole(role);
    if (!kind) {
      return errorResponse(500, "Unable to create your account right now.");
    }

    let uniqueId = generateUniqueId(kind);
    for (let attempt = 0; attempt < MAX_UNIQUE_ID_ATTEMPTS; attempt += 1) {
      const taken = await User.findOne({ uniqueId }).select("_id").lean();
      if (!taken) break;
      uniqueId = generateUniqueId(kind);
      if (attempt === MAX_UNIQUE_ID_ATTEMPTS - 1) {
        return errorResponse(
          503,
          "Unable to allocate your account ID right now. Please try again.",
        );
      }
    }

    const user = await User.create({
      name,
      email,
      phone,
      uniqueId,
      passwordHash,
      role,
      isActive: true,
    });

    await clearOtp(email, "PATIENT_SIGNUP");

    const safeUser = toSafeUser(user);

    await setSessionCookie(
      { sub: safeUser.id, role: safeUser.role },
      { rememberMe: false },
    );

    return NextResponse.json<OtpVerifySuccessBody>(
      {
        success: true,
        user: safeUser,
        redirectTo: "/patient/dashboard",
      },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return errorResponse(
        409,
        "An account with this email already exists. Sign in instead.",
      );
    }
    logApiFailure("auth/otp/verify", error);
    return errorResponse(
      503,
      "Unable to create your account right now. Please try again.",
    );
  }
}
