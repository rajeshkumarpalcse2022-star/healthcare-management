import { NextResponse } from "next/server";

import { clearSessionCookie } from "@/lib/auth";
import type { LogoutSuccessBody } from "@/types/auth";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * POST /api/auth/logout
 *
 * Clears the session cookie. Idempotent: succeeds whether or not a session
 * existed, so clients can always route to /login afterwards.
 */
export async function POST(): Promise<NextResponse> {
  try {
    await clearSessionCookie();
  } catch (error) {
    console.error(
      "[api/auth/logout] failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return NextResponse.json<LogoutSuccessBody>(
      { success: true },
      { status: 200, headers: NO_STORE },
    );
  }

  return NextResponse.json<LogoutSuccessBody>(
    { success: true },
    { status: 200, headers: NO_STORE },
  );
}
