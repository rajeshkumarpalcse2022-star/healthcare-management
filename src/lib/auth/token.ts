import "server-only";

import { SignJWT, jwtVerify } from "jose";

import { SESSION_LIFETIME } from "@/config/auth";
import { environment } from "@/config/environment";
import { isRole } from "@/config/roles";
import type { SessionPayload } from "@/types/auth";

/**
 * Signed session tokens (HS256 JWT via `jose`).
 *
 * The token carries only the user id and role - no personal data, no
 * credentials. Verification is stateless and server-side; the HTTP-only
 * cookie holding the token is never readable from client JavaScript.
 */

const TOKEN_ALGORITHM = "HS256";

function secretKey(): Uint8Array {
  return new TextEncoder().encode(environment.auth.secret);
}

interface CreateTokenOptions {
  /** Extends both the cookie and the token to the "remembered" lifetime. */
  rememberMe: boolean;
}

/** Signs a session token for the given user. */
export async function createSessionToken(
  payload: SessionPayload,
  options: CreateTokenOptions,
): Promise<string> {
  const lifetime = options.rememberMe
    ? SESSION_LIFETIME.remembered
    : SESSION_LIFETIME.standard;

  return new SignJWT({ role: payload.role })
    .setProtectedHeader({ alg: TOKEN_ALGORITHM })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${lifetime}s`)
    .sign(secretKey());
}

/**
 * Verifies signature and expiry, returning the claims or `null`.
 * Invalid, expired, tampered or misconfigured tokens all fail closed.
 */
export async function verifySessionToken(
  token: string,
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      algorithms: [TOKEN_ALGORITHM],
    });

    const sub = payload.sub;
    if (typeof sub !== "string" || sub.length === 0 || !isRole(payload.role)) {
      return null;
    }

    return { sub, role: payload.role };
  } catch {
    return null;
  }
}
