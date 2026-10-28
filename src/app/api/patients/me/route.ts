import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import {
  errorResponse,
  itemResponse,
  logApiFailure,
} from "@/lib/api/response";
import { PatientProfile } from "@/models/PatientProfile";
import { toFieldIssues } from "@/lib/validation/common";
import { patientSelfPutSchema } from "@/lib/validation/patient";
import { toPatientSelfDto } from "@/lib/patient/dto";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/**
 * Builds the `$set` for the self-PUT. Demographics only - `notes` and
 * `isActive` are not part of the schema, so they can never appear here.
 */
function buildSelf$set(updates: {
  dateOfBirth?: string | null;
  gender?: string | null;
  bloodGroup?: string | null;
  address?: unknown;
  emergencyContact?: unknown;
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
  return $set;
}

/**
 * GET /api/patients/me
 *
 * Patient self-view (PATIENT only). Returns identity from the verified
 * session plus demographics from the optional profile row. A legacy account
 * with no profile gets a synthesized blank profile (`hasProfile:false`) and
 * the read performs NO write - the row is only created by the patient's own
 * PUT or by an administrator's PATCH. The `notes` key is absent entirely.
 */
export async function GET(): Promise<NextResponse> {
  let actor: SafeUser;
  try {
    actor = await requireRole(ROLES.PATIENT);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  try {
    await connectToDatabase();

    const profile = await PatientProfile.findOne({ userId: actor.id }).lean();
    return itemResponse(
      toPatientSelfDto(
        {
          _id: actor.id,
          name: actor.name,
          email: actor.email,
          phone: actor.phone ?? null,
          isActive: true,
          createdAt: actor.createdAt,
        },
        profile,
      ),
    );
  } catch (error) {
    logApiFailure("patients/me", error);
    return errorResponse(
      503,
      "Unable to load your profile right now. Please try again.",
    );
  }
}

/**
 * PUT /api/patients/me
 *
 * Patient self-upsert of demographics (PATIENT only). Creates the profile
 * row on first save. Cannot touch `notes` (staff-only) or `isActive`
 * (administrator decision) - neither field exists in the accepted schema.
 */
export async function PUT(request: Request): Promise<NextResponse> {
  let actor: SafeUser;
  try {
    actor = await requireRole(ROLES.PATIENT);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = patientSelfPutSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const $set = buildSelf$set(parsed.data);
  if (Object.keys($set).length === 0) {
    return errorResponse(400, "Provide at least one field to update.");
  }

  try {
    await connectToDatabase();

    const profile = await PatientProfile.findOneAndUpdate(
      { userId: actor.id },
      { $set },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
    ).lean();

    return itemResponse(
      toPatientSelfDto(
        {
          _id: actor.id,
          name: actor.name,
          email: actor.email,
          phone: actor.phone ?? null,
          isActive: true,
          createdAt: actor.createdAt,
        },
        profile,
      ),
    );
  } catch (error) {
    logApiFailure("patients/me/put", error);
    return errorResponse(
      503,
      "Unable to save your profile right now. Please try again.",
    );
  }
}
