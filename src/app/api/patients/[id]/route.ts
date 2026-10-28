import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import {
  errorResponse,
  isDuplicateKeyError,
  itemResponse,
  logApiFailure,
} from "@/lib/api/response";
import { User } from "@/models/User";
import { PatientProfile } from "@/models/PatientProfile";
import { toFieldIssues } from "@/lib/validation/common";
import {
  patientIdSchema,
  patientPatchSchema,
} from "@/lib/validation/patient";
import { toPatientDto } from "@/lib/patient/dto";

export const dynamic = "force-dynamic";

/** Roles that may READ a patient record (platform-wide by approved design). */
const READ_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
] as const;

/** Roles that may EDIT demographics / notes / record status (staff-side). */
const EDIT_ROLES = [ROLES.SUPER_ADMIN, ROLES.ADMIN] as const;

/**
 * Resolves `[id]` to a PATIENT-role User or null. Non-patient accounts and
 * unknown ids both answer 404 so this surface never confirms the existence
 * of non-patient users.
 */
async function findPatientUser(id: string) {
  return User.findOne({ _id: id, role: ROLES.PATIENT }).lean();
}

/**
 * Builds the `$set` for a demographics PATCH. Undefined keys are skipped
 * (leave unchanged); `null` clears. `dateOfBirth` arrives as `YYYY-MM-DD`
 * and is stored as UTC midnight, matching the platform's calendar-date
 * convention on bookings.
 */
function buildProfile$set(updates: {
  dateOfBirth?: string | null;
  gender?: string | null;
  bloodGroup?: string | null;
  address?: unknown;
  emergencyContact?: unknown;
  notes?: string | null;
  isActive?: boolean;
}): Record<string, unknown> {
  const $set: Record<string, unknown> = {};
  if (updates.dateOfBirth !== undefined) {
    $set.dateOfBirth = updates.dateOfBirth
      ? new Date(`${updates.dateOfBirth}T00:00:00.000Z`)
      : null;
  }
  if (updates.gender !== undefined) $set.gender = updates.gender;
  if (updates.bloodGroup !== undefined) $set.bloodGroup = updates.bloodGroup;
  if (updates.address !== undefined) $set.address = updates.address;
  if (updates.emergencyContact !== undefined) {
    $set.emergencyContact = updates.emergencyContact;
  }
  if (updates.notes !== undefined) $set.notes = updates.notes;
  if (updates.isActive !== undefined) $set.isActive = updates.isActive;
  return $set;
}

/**
 * GET /api/patients/[id]
 *
 * Staff patient detail (LAB_MANAGER / STAFF / ADMIN / SUPER_ADMIN).
 * Returns identity from the PATIENT User plus demographics from the optional
 * profile row (synthesized blank when absent - no write on read). Notes are
 * included for these staff roles.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireRole(...READ_ROLES);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { id } = await params;
  const parsedId = patientIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid patient id.");
  }

  try {
    await connectToDatabase();

    const user = await findPatientUser(parsedId.data.id);
    if (!user) {
      return errorResponse(404, "Patient not found.");
    }

    const profile = await PatientProfile.findOne({ userId: user._id }).lean();
    return itemResponse(toPatientDto(user, profile));
  } catch (error) {
    logApiFailure("patients/[id]", error);
    return errorResponse(
      503,
      "Unable to load the patient right now. Please try again.",
    );
  }
}

/**
 * PATCH /api/patients/[id]
 *
 * Staff-side demographics edit (ADMIN / SUPER_ADMIN only - LAB_MANAGER and
 * STAFF are read-only on this surface by approved design). Upserts the
 * profile row, which doubles as the "Add profile" action for legacy
 * PATIENT accounts that never had one.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireRole(...EDIT_ROLES);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { id } = await params;
  const parsedId = patientIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid patient id.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = patientPatchSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check the patient details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const $set = buildProfile$set(parsed.data);
  if (Object.keys($set).length === 0) {
    return errorResponse(400, "Provide at least one field to update.");
  }

  try {
    await connectToDatabase();

    const user = await findPatientUser(parsedId.data.id);
    if (!user) {
      return errorResponse(404, "Patient not found.");
    }

    const profile = await PatientProfile.findOneAndUpdate(
      { userId: user._id },
      { $set },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
    ).lean();

    return itemResponse(toPatientDto(user, profile));
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return errorResponse(409, "This patient already has a profile.");
    }
    logApiFailure("patients/[id]/patch", error);
    return errorResponse(
      503,
      "Unable to update the patient right now. Please try again.",
    );
  }
}
