import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireAuth } from "@/lib/auth";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import { toDoctorPublicProfile } from "@/lib/appointment/dto";
import { connectToDatabase } from "@/lib/db";
import { Doctor } from "@/models/Doctor";
import { toFieldIssues } from "@/lib/validation/common";
import { appointmentIdSchema } from "@/lib/validation/appointment";
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
 * GET /api/doctors/directory/[id]
 *
 * Public-safe doctor profile shown before booking. Doctors that are
 * deactivated or whose clinic is inactive are not eligible to accept
 * appointments and surface as 404 - the directory never advertises them.
 * Private fields (email, phone, registration number, date of birth, account
 * link) are never exposed through this projection.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireAuth();
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  if (!DIRECTORY_ROLES.includes(user.role)) {
    return errorResponse(403, "You do not have permission to view doctor profiles.");
  }

  const { id } = await context.params;
  const parsed = appointmentIdSchema.safeParse({ id });
  if (!parsed.success) {
    return errorResponse(400, "Invalid doctor id.", toFieldIssues(parsed.error));
  }

  try {
    await connectToDatabase();

    const doctor = await Doctor.findById(parsed.data.id)
      .populate("clinicId", "name city isActive imageUrl latitude longitude")
      .populate("clinicIds", "name city isActive imageUrl latitude longitude")
      .lean();
    if (!doctor || !doctor.isActive) {
      return errorResponse(404, "Doctor not found.");
    }

    const profile = toDoctorPublicProfile(doctor);
    if (profile.clinics.length === 0) {
      return errorResponse(404, "Doctor not found.");
    }

    return itemResponse(profile);
  } catch (error) {
    logApiFailure("doctors/directory/detail", error);
    return errorResponse(
      503,
      "Unable to load the doctor profile right now. Please try again.",
    );
  }
}
