import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireRole } from "@/lib/auth";
import {
  errorResponse,
  itemResponse,
  logApiFailure,
} from "@/lib/api/response";
import { toClinicDto } from "@/lib/api/serializers";
import { getActiveDoctorProfileForUser } from "@/lib/appointment/authorization";
import { connectToDatabase } from "@/lib/db";
import { toFieldIssues } from "@/lib/validation/common";
import { doctorClinicUpdateSchema } from "@/lib/validation/clinic";
import { Clinic } from "@/models/Clinic";

export const dynamic = "force-dynamic";

/**
 * GET /api/doctors/me/clinic
 *
 * Full details of the clinic assigned to the signed-in doctor's own profile.
 * The clinic id always comes from the server-side Doctor record, so a doctor
 * can never inspect an unrelated clinic through this endpoint.
 */
export async function GET(): Promise<NextResponse> {
  let user;
  try {
    user = await requireRole(ROLES.DOCTOR);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  try {
    await connectToDatabase();

    const profile = await getActiveDoctorProfileForUser(user.id);
    if (!profile) {
      return errorResponse(
        403,
        "Your doctor profile is not active yet. Complete the approval process first.",
      );
    }

    if (!profile.clinicId) {
      return errorResponse(
        404,
        "No clinic is assigned to your profile yet. Contact an administrator.",
      );
    }

    const clinic = await Clinic.findById(profile.clinicId).lean();
    if (!clinic) {
      return errorResponse(
        404,
        "The clinic assigned to your profile could not be found.",
      );
    }

    return itemResponse(toClinicDto(clinic));
  } catch (error) {
    logApiFailure("doctors/me/clinic", error);
    return errorResponse(
      503,
      "Unable to load your clinic right now. Please try again.",
    );
  }
}

/**
 * PATCH /api/doctors/me/clinic
 *
 * Self-service update for the clinic assigned to the signed-in doctor.
 * Editable: name, contact details, address and registration number. Clinic
 * code, active status and assignment are administrator-managed and are not
 * accepted here.
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  let user;
  try {
    user = await requireRole(ROLES.DOCTOR);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = doctorClinicUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  if (Object.keys(parsed.data).length === 0) {
    return errorResponse(400, "No changes were provided.");
  }

  try {
    await connectToDatabase();

    const profile = await getActiveDoctorProfileForUser(user.id);
    if (!profile) {
      return errorResponse(
        403,
        "Your doctor profile is not active yet. Complete the approval process first.",
      );
    }

    if (!profile.clinicId) {
      return errorResponse(
        404,
        "No clinic is assigned to your profile yet. Contact an administrator.",
      );
    }

    const clinic = await Clinic.findByIdAndUpdate(
      profile.clinicId,
      { $set: parsed.data },
      { new: true, runValidators: true },
    ).lean();

    if (!clinic) {
      return errorResponse(
        404,
        "The clinic assigned to your profile could not be found.",
      );
    }

    return itemResponse(toClinicDto(clinic));
  } catch (error) {
    logApiFailure("doctors/me/clinic/update", error);
    return errorResponse(
      503,
      "Unable to update your clinic right now. Please try again.",
    );
  }
}
