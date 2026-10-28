import { NextResponse } from "next/server";

import {
  resolvePostLoginRedirect,
  setSessionCookie,
  toSafeUser,
  verifyPassword,
} from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { User } from "@/models/User";
import {
  loginSchema,
  normalizeEmail,
  toFieldIssues,
} from "@/lib/validation/auth";
import type { AuthErrorBody, LoginSuccessBody } from "@/types/auth";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Valid bcrypt hash of a random throwaway value. Compared when the account
 * does not exist so response timing stays uniform - prevents user enumeration
 * through response-time differences. It is not a credential for any account.
 */
const TIMING_EQUALIZER_HASH =
  "$2b$12$AojInxZJQguAgXLy1XsO3eXemmQ//GVxK0ZsbJZDjm79EbWz9Vpp.";

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
 * POST /api/auth/login
 *
 * Validates input, verifies credentials server-side and issues the HTTP-only
 * session cookie. Failure messages stay generic so responses never reveal
 * whether an email address exists.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const { password, rememberMe, next } = parsed.data;
  const email = normalizeEmail(parsed.data.email);

  try {
    await connectToDatabase();

    const user = await User.findOne({ email }).select("+passwordHash");

    if (!user) {
      await verifyPassword(password, TIMING_EQUALIZER_HASH);
      return errorResponse(401, "Invalid email or password.");
    }

    const passwordValid = await verifyPassword(password, user.passwordHash);
    if (!passwordValid) {
      return errorResponse(401, "Invalid email or password.");
    }

    if (!user.isActive) {
      return errorResponse(
        403,
        "Your account is inactive. Contact your administrator.",
      );
    }

    const safeUser = toSafeUser(user);
    const redirectTo = await resolvePostLoginRedirect(safeUser, next);

    await setSessionCookie(
      { sub: safeUser.id, role: safeUser.role },
      { rememberMe },
    );

    return NextResponse.json<LoginSuccessBody>(
      { success: true, user: safeUser, redirectTo },
      { status: 200, headers: NO_STORE },
    );
  } catch (error) {
    // Logged server-side only; the response stays generic - no stack traces
    // and never any credential material.
    console.error(
      "[api/auth/login] failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return errorResponse(
      503,
      "Unable to sign you in right now. Please try again.",
    );
  }
}
