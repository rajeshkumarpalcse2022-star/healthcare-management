import "server-only";

import { cookies } from "next/headers";

import { SESSION_COOKIE_NAME, SESSION_LIFETIME } from "@/config/auth";
import { environment } from "@/config/environment";
import type { SessionPayload } from "@/types/auth";

import { createSessionToken, verifySessionToken } from "./token";

/**
 * Cookie-backed session storage.
 *
 * The session lives in a single HTTP-only cookie:
 * - never exposed to client-side JavaScript or localStorage
 * - `SameSite=Lax` + `Secure` in production
 * - browser-session cookie by default; persistent when "Remember me" is set
 *
 * `getSession()` only proves the token is authentic and unexpired. Loading the
 * user (and checking `isActive`) happens in `getCurrentUser()`.
 */

const BASE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  secure: environment.isProduction,
} as const;

/**
 * Next.js signals "this needs dynamic rendering" by throwing an error with
 * the `DYNAMIC_SERVER_USAGE` digest. Rethrowing it (instead of logging it)
 * lets the build mark the route dynamic and keeps build output clean.
 */
function isDynamicUsageError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    (error as { digest?: unknown }).digest === "DYNAMIC_SERVER_USAGE"
  );
}

/** Reads and verifies the session cookie. Returns `null` when unauthenticated. */
export async function getSession(): Promise<SessionPayload | null> {
  if (!environment.auth.isConfigured) {
    console.error(
      "[auth] AUTH_SECRET is not configured - sessions are rejected. " +
        "Add it to .env.local (see .env.example).",
    );
    return null;
  }

  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return null;

    return await verifySessionToken(token);
  } catch (error) {
    if (isDynamicUsageError(error)) throw error;
    console.error(
      "[auth] getSession failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return null;
  }
}

/** Issues the HTTP-only session cookie for a freshly authenticated user. */
export async function setSessionCookie(
  payload: SessionPayload,
  options: { rememberMe: boolean },
): Promise<void> {
  const token = await createSessionToken(payload, options);
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, token, {
    ...BASE_COOKIE_OPTIONS,
    ...(options.rememberMe ? { maxAge: SESSION_LIFETIME.remembered } : {}),
  });
}

/** Clears the session cookie (logout). */
export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();

  cookieStore.set(SESSION_COOKIE_NAME, "", {
    ...BASE_COOKIE_OPTIONS,
    maxAge: 0,
  });
}
