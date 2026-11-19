import { NextResponse } from "next/server";

import { environment } from "@/config/environment";
import { connectToDatabase } from "@/lib/db";
import { createOtp, OTP_TTL_SECONDS } from "@/lib/otp";
import { sendOtpEmail } from "@/lib/mailer";
import { User } from "@/models/User";
import { normalizeEmail } from "@/lib/validation/auth";
import type { AuthErrorBody, OtpSendSuccessBody } from "@/types/auth";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function errorResponse(
  status: number,
  error: string,
): NextResponse {
  return NextResponse.json<AuthErrorBody>(
    { success: false, error },
    { status, headers: NO_STORE },
  );
}

/**
 * POST /api/auth/otp/send
 *
 * Sends a 6-digit verification OTP to the given email for patient signup.
 * Always answers 200 for well-formed requests so the endpoint cannot be used
 * to enumerate existing accounts; actual delivery failures are logged
 * server-side and surfaced as a generic error.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const email =
    typeof body === "object" && body !== null && "email" in body
      ? normalizeEmail(String((body as { email: unknown }).email ?? ""))
      : "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return errorResponse(400, "Enter a valid email address.");
  }

  if (!environment.smtp.isConfigured) {
    console.error("[api/auth/otp/send] SMTP is not configured.");
    return errorResponse(
      503,
      "Email service is unavailable right now. Please try again later.",
    );
  }

  try {
    await connectToDatabase();

    // Reject registration when the email is already taken - but only after
    // the OTP step so the form can surface the error at the right moment.
    // (Checked again on verify to close the race.)
    const existing = await User.findOne({ email }).select("_id").lean();
    if (existing) {
      return errorResponse(
        409,
        "An account with this email already exists. Sign in instead.",
      );
    }

    const result = await createOtp(email, "PATIENT_SIGNUP");
    if (!result.ok || !result.code) {
      const retryAfter = result.retryAfterSeconds ?? 60;
      return NextResponse.json<AuthErrorBody>(
        {
          success: false,
          error: `Please wait ${retryAfter} seconds before requesting another code.`,
        },
        { status: 429, headers: { ...NO_STORE, "Retry-After": String(retryAfter) } },
      );
    }

    // Best-effort display name for the email body; full details arrive on verify.
    await sendOtpEmail({ to: email, otp: result.code, name: "there" });

    return NextResponse.json<OtpSendSuccessBody>(
      { success: true, expiresInSeconds: OTP_TTL_SECONDS },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    console.error(
      "[api/auth/otp/send] failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return errorResponse(
      503,
      "Unable to send the verification code right now. Please try again.",
    );
  }
}
