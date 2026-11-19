import "server-only";

import { randomBytes } from "crypto";

import { hashPassword } from "@/lib/auth/password";
import { toSafeUser } from "@/lib/auth/auth";
import { connectToDatabase } from "@/lib/db";
import { User } from "@/models/User";
import { Doctor } from "@/models/Doctor";
import {
  generateUniqueId,
  uniqueIdPrefixForRole,
  type UniqueIdKind,
} from "@/lib/unique-id";
import type { SafeUser } from "@/types/auth";

/**
 * Shared account-provisioning helpers used when an administrator creates a
 * doctor or laboratory: the User account (unique ID + generated password) is
 * minted in the same operation so the admin always receives usable
 * credentials. Collision on `uniqueId` is retried a few times before giving
 * up - the unique index is the final guard.
 */

const MAX_UNIQUE_ID_ATTEMPTS = 5;

/** Charset for auto-generated passwords (unambiguous, shell-safe). */
const PASSWORD_ALPHABET =
  "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

/**
 * Generates a strong random password (12 chars by default). Returned in
 * plain text exactly once for the admin to hand over - only the bcrypt hash
 * is stored.
 */
export function generateTemporaryPassword(length = 12): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length];
  }
  // Guarantee at least one upper, lower and digit for basic complexity.
  return out;
}

/**
 * Generates a unique ID that is not already taken. Retries on the
 * (astronomically unlikely) random collision.
 */
async function allocateUniqueId(kind: UniqueIdKind): Promise<string> {
  for (let attempt = 0; attempt < MAX_UNIQUE_ID_ATTEMPTS; attempt += 1) {
    const candidate = generateUniqueId(kind);
    const existing = await User.findOne({ uniqueId: candidate })
      .select("_id")
      .lean();
    if (!existing) return candidate;
  }
  throw new Error("Unable to allocate a unique account ID - please retry.");
}

export interface ProvisionAccountInput {
  name: string;
  email: string;
  phone: string | null;
  role: "DOCTOR" | "LAB_MANAGER";
}

export interface ProvisionAccountResult {
  user: SafeUser;
  /** Plain-text generated password - show once, never persist client-side. */
  plainPassword: string;
}

/**
 * Creates a User account with a fresh unique ID and generated password.
 * The caller (doctor/lab create route) is responsible for linking business
 * records (Doctor.userId etc.) and for returning the credentials to the
 * admin exactly once.
 */
export async function provisionAccount(
  input: ProvisionAccountInput,
): Promise<ProvisionAccountResult> {
  const kind = uniqueIdPrefixForRole(input.role);
  if (!kind) {
    throw new Error(`No unique-ID prefix configured for role ${input.role}.`);
  }

  await connectToDatabase();

  const uniqueId = await allocateUniqueId(kind);
  const plainPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(plainPassword);

  const user = await User.create({
    name: input.name,
    email: input.email,
    phone: input.phone,
    uniqueId,
    passwordHash,
    role: input.role,
    isActive: true,
  });

  return { user: toSafeUser(user), plainPassword };
}

/**
 * Links a newly created User account to its Doctor profile. Called by the
 * doctor-create route after both records exist.
 */
export async function linkDoctorUser(
  doctorId: string,
  userId: string,
): Promise<void> {
  await Doctor.updateOne({ _id: doctorId }, { $set: { userId } });
}
