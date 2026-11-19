import "server-only";

import { randomBytes } from "crypto";

/**
 * Unique account-ID generation for every user type.
 *
 * Format: `PREFIX-XXXXX` where XXXXX is a 5-character Crockford-base32
 * string (no ambiguous characters like 0/O/1/I/L). The ID is display-safe,
 * case-insensitive on lookup, and long enough that random collisions are
 * negligible; the unique index on `User.uniqueId` is the final guard.
 *
 * Prefixes:
 * - `PAT` - patient self-registered accounts
 * - `DOC` - doctor accounts provisioned by an administrator
 * - `LAB` - laboratory (LAB_MANAGER) accounts provisioned by an administrator
 */

/** Crockford Base32 alphabet (excludes I, L, O, U to avoid look-alikes). */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const ID_BODY_LENGTH = 5;

export const UNIQUE_ID_PREFIXES = {
  PATIENT: "PAT",
  DOCTOR: "DOC",
  LAB: "LAB",
} as const;

export type UniqueIdKind = keyof typeof UNIQUE_ID_PREFIXES;

/** Regex every generated (and backfilled) unique ID must match. */
export const UNIQUE_ID_PATTERN = /^(PAT|DOC|LAB)-[0-9A-HJKMNP-TV-Z]{5}$/;

/** Maps a user role to its unique-ID prefix. Null when the role has none. */
export function uniqueIdPrefixForRole(role: string): UniqueIdKind | null {
  if (role === "PATIENT") return "PATIENT";
  if (role === "DOCTOR") return "DOCTOR";
  if (role === "LAB_MANAGER") return "LAB";
  return null;
}

function randomBody(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/**
 * Generates a fresh unique ID for the given kind, e.g. `DOC-8F3K2`.
 *
 * Purely random - callers must rely on the `uniqueId` unique index to retry
 * on the (astronomically unlikely) collision.
 */
export function generateUniqueId(kind: UniqueIdKind): string {
  return `${UNIQUE_ID_PREFIXES[kind]}-${randomBody(ID_BODY_LENGTH)}`;
}

/** Normalises a user-supplied unique ID for lookup (trim + uppercase). */
export function normalizeUniqueId(value: string): string {
  return value.trim().toUpperCase();
}

/** Returns true when the value looks like a well-formed unique ID. */
export function isUniqueIdShape(value: string): boolean {
  return UNIQUE_ID_PATTERN.test(normalizeUniqueId(value));
}
