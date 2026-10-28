import { NextResponse } from "next/server";
import { Types } from "mongoose";

import { ROLES } from "@/config/roles";
import {
  authErrorResponse,
  hashPassword,
  requireRole,
} from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import {
  buildListMeta,
  errorResponse,
  isDuplicateKeyError,
  itemResponse,
  listResponse,
  logApiFailure,
} from "@/lib/api/response";
import { User } from "@/models/User";
import { PatientProfile } from "@/models/PatientProfile";
import { containsRegex, toFieldIssues } from "@/lib/validation/common";
import {
  patientCreateSchema,
  patientListQuerySchema,
} from "@/lib/validation/patient";
import { toPatientDto } from "@/lib/patient/dto";
import { generateTemporaryPassword } from "@/lib/patient/temp-password";

export const dynamic = "force-dynamic";

/** Roles that may browse the platform-wide patient directory. */
const DIRECTORY_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
] as const;

/**
 * GET /api/patients
 *
 * Platform-wide patient directory (P1-1). LAB_MANAGER/STAFF see the whole
 * directory by approved design - patients are not laboratory-owned in this
 * MVP - alongside ADMIN / SUPER_ADMIN. Rows join the PATIENT-role User
 * (identity) with its optional PatientProfile (demographics); accounts
 * without a profile render a synthesized blank profile (`hasProfile:false`).
 * `status` filters on the RECORD switch: `inactive` matches
 * `profile.isActive:false`; `active` also includes legacy accounts with no
 * profile row at all.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireRole(...DIRECTORY_ROLES);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { searchParams } = new URL(request.url);
  const parsed = patientListQuerySchema.safeParse({
    search: searchParams.get("search") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    page: searchParams.get("page") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your search parameters and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const { search, status, page, limit } = parsed.data;

  const filter: Record<string, unknown> = { role: ROLES.PATIENT };
  if (search) {
    filter.$or = [
      { name: containsRegex(search) },
      { email: containsRegex(search) },
      { phone: containsRegex(search) },
    ];
  }

  try {
    await connectToDatabase();

    if (status) {
      // Record-status filter resolves through the profile collection: both
      // branches still return legacy no-profile accounts on the "active" side.
      const inactiveIds = await PatientProfile.find({ isActive: false })
        .select("userId")
        .lean();
      const ids = inactiveIds.map((row) => row.userId);
      if (status === "inactive") {
        filter._id = { $in: ids };
      } else {
        filter._id = { $nin: ids };
      }
    }

    const [total, docs] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const profiles = await PatientProfile.find({
      userId: { $in: docs.map((doc) => doc._id) },
    }).lean();
    const profileByUser = new Map(
      profiles.map((profile) => [String(profile.userId), profile]),
    );

    const rows = docs.map((doc) =>
      toPatientDto(doc, profileByUser.get(String(doc._id)) ?? null),
    );
    return listResponse(rows, buildListMeta(page, limit, total));
  } catch (error) {
    logApiFailure("patients", error);
    return errorResponse(
      503,
      "Unable to load patients right now. Please try again.",
    );
  }
}

/**
 * POST /api/patients
 *
 * Staff-created patient account (ADMIN / SUPER_ADMIN only). Creates the
 * PATIENT-role User first, then the PatientProfile; if the profile insert
 * fails the just-created User is deleted again (compensating cleanup) so a
 * partial failure can never leave an orphaned account without its profile.
 * The password is optional - omitted means the server generates a temporary
 * one. A generated password is returned exactly once in the response and is
 * never logged; only its bcrypt hash is stored. No session is issued.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    await requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = patientCreateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check the patient details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const { name, email, profile } = parsed.data;
  const phone = parsed.data.phone ?? null;
  const generatedPassword =
    parsed.data.password === undefined ? generateTemporaryPassword() : null;
  const plainPassword = parsed.data.password ?? generatedPassword;
  if (!plainPassword) {
    return errorResponse(400, "Check the patient details and try again.");
  }

  let createdUserId: string | null = null;
  try {
    await connectToDatabase();

    const existing = await User.findOne({ email }).select("_id").lean();
    if (existing) {
      return errorResponse(409, "An account with this email already exists.");
    }

    const passwordHash = await hashPassword(plainPassword);
    const user = await User.create({
      name,
      email,
      phone,
      passwordHash,
      role: ROLES.PATIENT,
      isActive: true,
    });
    createdUserId = String(user._id);

    const profileDoc = await PatientProfile.create({
      userId: user._id,
      dateOfBirth: profile?.dateOfBirth
        ? new Date(`${profile.dateOfBirth}T00:00:00.000Z`)
        : null,
      gender: profile?.gender ?? null,
      bloodGroup: profile?.bloodGroup ?? null,
      address: profile?.address ?? null,
      emergencyContact: profile?.emergencyContact ?? null,
      notes: profile?.notes ?? null,
      isActive: true,
    });

    const response = itemResponse(
      {
        patient: toPatientDto(user, profileDoc),
        // One-time handoff: present only when the SERVER generated it. A
        // staff-chosen password is never echoed back.
        ...(generatedPassword ? { temporaryPassword: generatedPassword } : {}),
      },
      201,
    );
    return response;
  } catch (error) {
    // Compensating cleanup: never leave a PATIENT account behind without its
    // profile when the second insert failed.
    if (createdUserId) {
      try {
        await User.deleteOne({ _id: new Types.ObjectId(createdUserId) });
      } catch (cleanupError) {
        logApiFailure("patients/create/cleanup", cleanupError);
      }
    }
    if (isDuplicateKeyError(error)) {
      return errorResponse(409, "An account with this email already exists.");
    }
    logApiFailure("patients/create", error);
    return errorResponse(
      503,
      "Unable to create the patient right now. Please try again.",
    );
  }
}
