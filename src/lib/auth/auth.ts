import "server-only";

import { NextResponse } from "next/server";

import { type Role } from "@/config/roles";
import { getDashboardRouteForRole } from "@/config/auth";
import { connectToDatabase, withDatabaseRetry } from "@/lib/db";
import { Doctor } from "@/models/Doctor";
import { User, type UserRecord } from "@/models/User";
import { sanitizeNextPath } from "@/lib/validation/auth";
import type { SafeUser } from "@/types/auth";

import { getSession } from "./session";
import {
  AuthError,
  INFRASTRUCTURE_ERROR_MESSAGE,
  InfrastructureError,
  isAuthError,
} from "./errors";

export {
  AuthError,
  INFRASTRUCTURE_ERROR_MESSAGE,
  InfrastructureError,
  isAuthError,
};

/**
 * Server-side authentication helpers - the single source of truth for "who is
 * making this request".
 *
 * Usage:
 * - API routes:      `requireAuth()` / `requireRole(ROLES.ADMIN)` in a
 *                    try/catch paired with `authErrorResponse()`.
 * - Server pages:    `getCurrentUser()` + `redirect(LOGIN_ROUTE)` when null.
 *                    (Throwing helpers render an error page, not a redirect.)
 *
 * Failure semantics:
 * - genuine authentication failures (no session, invalid token, missing
 *   user, inactive account) surface as `null` -> 401;
 * - database/infrastructure failures during session resolution throw
 *   `InfrastructureError` -> retryable 503 (see `./errors.ts`).
 */

/**
 * Converts an `AuthError` to a JSON response; `null` for other errors.
 * 503 responses carry `Retry-After: 2` so clients retry instead of treating
 * the condition as an authentication problem.
 */
export function authErrorResponse(error: unknown): NextResponse | null {
  if (!isAuthError(error)) return null;

  return NextResponse.json(
    { success: false, error: error.message },
    {
      status: error.status,
      headers: {
        "Cache-Control": "no-store",
        ...(error.status === 503 ? { "Retry-After": "2" } : {}),
      },
    },
  );
}

/** Maps a stored user to the safe, credential-free shape. */
export function toSafeUser(user: UserRecord & { _id: unknown }): SafeUser {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    phone: user.phone ?? null,
    role: user.role,
    isActive: user.isActive,
    // Only forwarded when the stored value is an actual array - a missing
    // field must stay missing (legacy platform-wide account), never `[]`.
    ...(Array.isArray(user.laboratoryIds)
      ? { laboratoryIds: [...user.laboratoryIds] }
      : {}),
    createdAt:
      user.createdAt instanceof Date
        ? user.createdAt.toISOString()
        : String(user.createdAt),
  };
}

/**
 * Loads the authenticated user from the database.
 *
 * Genuine authentication failures - missing session, invalid token, missing
 * user, inactive account - return `null` (callers translate that to 401).
 * Database/infrastructure failures (connection dropped, query failed) THROW
 * `InfrastructureError` so callers answer a retryable 503 instead of a
 * misleading 401. Details are logged server-side only - never to the client.
 */
export async function getCurrentUser(): Promise<SafeUser | null> {
  const session = await getSession();
  if (!session) return null;

  try {
    // Retry transient network failures (idle Atlas sockets dropping) before
    // surfacing a retryable 503 - the page error boundary stays available for
    // genuine outages.
    const user = await withDatabaseRetry(() => User.findById(session.sub));

    if (!user || !user.isActive) return null;
    return toSafeUser(user);
  } catch (error) {
    console.error(
      "[auth] getCurrentUser failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    throw new InfrastructureError();
  }
}

/**
 * Requires any authenticated, active user. Throws `AuthError(401)` for
 * genuine authentication failures; `InfrastructureError` (503) propagates
 * unchanged when the database cannot be reached.
 */
export async function requireAuth(): Promise<SafeUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthError(401, "Authentication required.");
  }
  return user;
}

/** Requires an active user holding one of the given roles. */
export async function requireRole(...roles: Role[]): Promise<SafeUser> {
  const user = await requireAuth();

  if (!roles.includes(user.role)) {
    throw new AuthError(
      403,
      "You do not have permission to perform this action.",
    );
  }

  return user;
}

/**
 * Resolves the post-login redirect destination.
 *
 * A valid client-supplied `next` path always wins. Otherwise each role is
 * sent to its dedicated dashboard. DOCTOR accounts without a linked, active
 * Doctor profile are routed to the pending-approval page instead of the full
 * dashboard.
 */
export async function resolvePostLoginRedirect(
  user: SafeUser,
  next: unknown,
): Promise<string> {
  const sanitized = sanitizeNextPath(next);
  if (sanitized) return sanitized;

  if (user.role === "DOCTOR") {
    try {
      await connectToDatabase();
      const doctor = await Doctor.findOne({
        userId: user.id,
        isActive: true,
      });
      if (!doctor) return "/doctor/pending";
    } catch {
      // Fall through to the default doctor dashboard on query failure;
      // the dashboard page itself re-checks and shows the pending state.
    }
  }

  return getDashboardRouteForRole(user.role);
}
