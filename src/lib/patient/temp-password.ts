import "server-only";

import { randomInt } from "node:crypto";

import { PATIENT_TEMP_PASSWORD_LENGTH } from "@/config/patients";

/**
 * Temporary-password generator for staff-created patient accounts (P1-1).
 *
 * Guarantees at least one upper-case letter, lower-case letter and digit, then
 * fills the remainder from an unambiguous charset (no O/0, l/1). The value is
 * returned to the authorized staff member exactly once in the create
 * response, bcrypt-hashed before storage, and never written to any log -
 * same one-time discipline the platform already applies to home-collection
 * OTPs (plaintext returned once, only the hash persisted).
 */
const UPPERCASE = "ABCDEFGHJKMNPQRSTUVWXYZ";
const LOWERCASE = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%&*?";
const FULL_CHARSET = UPPERCASE + LOWERCASE + DIGITS + SYMBOLS;

export function generateTemporaryPassword(
  length = PATIENT_TEMP_PASSWORD_LENGTH,
): string {
  const safeLength = Math.max(length, 8);
  const chars: string[] = [
    UPPERCASE[randomInt(UPPERCASE.length)],
    LOWERCASE[randomInt(LOWERCASE.length)],
    DIGITS[randomInt(DIGITS.length)],
  ];
  while (chars.length < safeLength) {
    chars.push(FULL_CHARSET[randomInt(FULL_CHARSET.length)]);
  }
  // Fisher-Yates shuffle with crypto-backed indices so the mandatory
  // complexity characters are not predictably pinned to the prefix.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
