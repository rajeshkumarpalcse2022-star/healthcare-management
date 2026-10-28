import { NextResponse } from "next/server";

import { authErrorResponse, getCurrentUser } from "@/lib/auth";
import type { AuthErrorBody, MeSuccessBody } from "@/types/auth";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/auth/me
 *
 * Returns the authenticated user from the session cookie, or 401 when the
 * session is missing, invalid, expired or the account is inactive. A
 * database/infrastructure failure during session resolution answers a
 * retryable 503 (generic message, `Retry-After: 2`) instead of a misleading
 * 401.
 */
export async function GET(): Promise<NextResponse> {
  let user;
  try {
    user = await getCurrentUser();
  } catch (error) {
    // InfrastructureError -> serialised as 503 with Retry-After; anything
    // else keeps propagating to the route-level error handling.
    const response = authErrorResponse(error);
    if (response) return response;
    throw error;
  }

  if (!user) {
    return NextResponse.json<AuthErrorBody>(
      { success: false, error: "Authentication required." },
      { status: 401, headers: NO_STORE },
    );
  }

  return NextResponse.json<MeSuccessBody>(
    { success: true, user },
    { status: 200, headers: NO_STORE },
  );
}
