import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireAuth } from "@/lib/auth";
import {
  buildListMeta,
  errorResponse,
  listResponse,
  logApiFailure,
} from "@/lib/api/response";
import { toDoctorDirectoryEntry } from "@/lib/appointment/dto";
import { connectToDatabase } from "@/lib/db";
import { Clinic } from "@/models/Clinic";
import { Doctor } from "@/models/Doctor";
import { containsRegex, toFieldIssues } from "@/lib/validation/common";
import { doctorDirectoryQuerySchema } from "@/lib/validation/appointment";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/** Roles allowed to browse the patient-facing doctor directory. */
const DIRECTORY_ROLES: string[] = [
  ROLES.PATIENT,
  ROLES.DOCTOR,
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
];

/**
 * GET /api/doctors/directory
 *
 * Public-safe doctor directory for booking: only active doctors practising
 * at an active clinic, with fields limited to what a patient needs to choose
 * a doctor (name, specialisation, qualification, experience, fee, clinic,
 * schedule-configured flag). Private contact details, registration numbers,
 * dates of birth and account links are never exposed through this projection.
 */
export async function GET(request: Request): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireAuth();
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  if (!DIRECTORY_ROLES.includes(user.role)) {
    return errorResponse(403, "You do not have permission to view the doctor directory.");
  }

  const { searchParams } = new URL(request.url);
  const parsed = doctorDirectoryQuerySchema.safeParse({
    search: searchParams.get("search") ?? undefined,
    specialization: searchParams.get("specialization") ?? undefined,
    clinic: searchParams.get("clinic") ?? undefined,
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

  const { search, specialization, clinic, page, limit } = parsed.data;

  try {
    await connectToDatabase();

    // Eligibility: approved (active) doctor at an active clinic.
    const activeClinicIds = await Clinic.find({ isActive: true })
      .select("_id")
      .lean();

    const allActiveIds = activeClinicIds.map((doc) => doc._id);
    const scopedIds = clinic
      ? activeClinicIds
          .filter((doc) => String(doc._id) === clinic)
          .map((doc) => doc._id)
      : allActiveIds;

    const filter: Record<string, unknown> = {
      isActive: true,
      $or: [
        { clinicId: { $in: scopedIds } },
        { clinicIds: { $in: scopedIds } },
      ],
    };

    if (specialization) {
      filter.specialization = containsRegex(specialization);
    }
    if (search) {
      filter.$and = [
        {
          $or: [
            { name: containsRegex(search) },
            { doctorCode: containsRegex(search) },
            { specialization: containsRegex(search) },
          ],
        },
      ];
    }

    const [total, docs] = await Promise.all([
      Doctor.countDocuments(filter),
      Doctor.find(filter)
        .sort({ name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("clinicId", "name city isActive imageUrl latitude longitude")
        .populate("clinicIds", "name city isActive imageUrl latitude longitude")
        .lean(),
    ]);

    return listResponse(
      docs.map(toDoctorDirectoryEntry),
      buildListMeta(page, limit, total),
    );
  } catch (error) {
    logApiFailure("doctors/directory", error);
    return errorResponse(
      503,
      "Unable to load the doctor directory right now. Please try again.",
    );
  }
}
