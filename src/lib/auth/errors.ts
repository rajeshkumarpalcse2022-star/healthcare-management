/**
 * Authentication error types - deliberately dependency-free (no
 * `next/server`, no models, no `server-only`) so the throwing contract is
 * importable from plain Node for offline regression tests.
 */

/**
 * Thrown by `requireAuth()` / `requireRole()` and by session-resolution
 * failures that must be reported to the client. Carries a safe HTTP status:
 * 401 (authentication required), 403 (role denial), or 503 (retryable
 * infrastructure failure during session resolution).
 */
export class AuthError extends Error {
  readonly status: 401 | 403 | 503;

  constructor(status: 401 | 403 | 503, message: string) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}

/**
 * Generic, retryable copy for infrastructure failures while resolving the
 * session. Deliberately reveals nothing about the underlying cause; the
 * detail stays in server-side logs only.
 */
export const INFRASTRUCTURE_ERROR_MESSAGE =
  "Service temporarily unavailable. Please try again.";

/**
 * A database/infrastructure failure occurred while resolving the session
 * (connection dropped, query failed) - a RETRYABLE condition, deliberately
 * distinct from a genuine authentication failure (missing/invalid session,
 * missing user, inactive account -> 401). Extends `AuthError` so the
 * existing `authErrorResponse` path serialises it as 503 with no per-route
 * changes.
 */
export class InfrastructureError extends AuthError {
  constructor(message: string = INFRASTRUCTURE_ERROR_MESSAGE) {
    super(503, message);
    this.name = "InfrastructureError";
  }
}
