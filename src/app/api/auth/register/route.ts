import { NextResponse } from "next/server";

import { hashPassword, setSessionCookie, toSafeUser } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { isDuplicateKeyError, logApiFailure } from "@/lib/api/response";
import { User } from "@/models/User";
import {
  registerSchema,
  normalizeEmail,
  toFieldIssues,
} from "@/lib/validation/auth";
import type { AuthErrorBody, RegisterSuccessBody } from "@/types/auth";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

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
 * POST /api/auth/register
 *
 * Creates a new PATIENT or DOCTOR account and issues a session cookie
 * (auto-login). Only `PATIENT` and `DOCTOR` are accepted - privileged
 * management roles (SUPER_ADMIN, ADMIN, LAB_MANAGER, STAFF, COLLECTOR)
 * are created exclusively through the SA/ADMIN provisioning endpoint
 * (`POST /api/users`) or the seed script (SUPER_ADMIN).
 *
 * The password is hashed with bcrypt (cost 12) before storage; the
 * plain-text value is never persisted or logged. Duplicate email addresses
 * are rejected with a generic message (no account-enumeration leak).
 */
export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const { name, password, role } = parsed.data;
  const email = normalizeEmail(parsed.data.email);
  const phone = parsed.data.phone?.trim() || null;

  try {
    await connectToDatabase();

    const existing = await User.findOne({ email });
    if (existing) {
      return errorResponse(409, "An account with this email already exists.");
    }

    const passwordHash = await hashPassword(password);

    const user = await User.create({
      name,
      email,
      phone,
      passwordHash,
      role,
      isActive: true,
    });

    const safeUser = toSafeUser(user);

    await setSessionCookie(
      { sub: safeUser.id, role: safeUser.role },
      { rememberMe: false },
    );

    return NextResponse.json<RegisterSuccessBody>(
      { success: true, user: safeUser },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return errorResponse(409, "An account with this email already exists.");
    }
    logApiFailure("auth/register", error);
    return errorResponse(
      503,
      "Unable to create your account right now. Please try again.",
    );
  }
}
