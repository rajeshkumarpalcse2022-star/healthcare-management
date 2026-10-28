import "server-only";

import bcrypt from "bcryptjs";

/**
 * Password hashing (bcrypt, cost factor 12).
 *
 * Server-side only: plain-text passwords never touch storage, logs or API
 * responses. bcrypt is pure-JS here so there is no native build step.
 */
const SALT_ROUNDS = 12;

/** Hashes a plain-text password. Never log or store the input. */
export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/**
 * Verifies a plain-text password against a stored hash.
 * Returns `false` for empty or malformed hashes instead of throwing.
 */
export async function verifyPassword(
  plainPassword: string,
  passwordHash: string,
): Promise<boolean> {
  if (!plainPassword || !passwordHash) {
    return false;
  }
  try {
    return await bcrypt.compare(plainPassword, passwordHash);
  } catch {
    return false;
  }
}
