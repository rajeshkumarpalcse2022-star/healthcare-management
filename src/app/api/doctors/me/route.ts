import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import {
  errorResponse,
  itemResponse,
  logApiFailure,
} from "@/lib/api/response";
import { toDoctorDto } from "@/lib/api/serializers";
import { Doctor } from "@/models/Doctor";
import { doctorSelfUpdateSchema } from "@/lib/validation/doctor";
import { toFieldIssues } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/doctors/me
 *
 * Self-service profile update for the signed-in DOCTOR. The profile is
 * resolved from the session (`Doctor.userId`), never from a client-supplied
 * id, so a doctor can only ever edit their own record.
 *
 * Editable: name, email, phone, specialization, qualification, registration
 * number, experience, consultation fee, gender, date of birth and bio.
 * Administrative fields (clinic assignment, doctor code, login link, active
 * status) are not accepted here - they stay with SUPER_ADMIN / ADMIN.
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

  const parsed = doctorSelfUpdateSchema.safeParse(body);
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

    const doctor = await Doctor.findOneAndUpdate(
      { userId: user.id },
      { $set: parsed.data },
      { new: true, runValidators: true },
    )
      .populate("clinicId", "name code city isActive imageUrl latitude longitude")
      .lean();

    if (!doctor) {
      return errorResponse(
        404,
        "No doctor profile is linked to your account. Contact an administrator.",
      );
    }

    return itemResponse(toDoctorDto(doctor));
  } catch (error) {
    logApiFailure("doctors/me/update", error);
    return errorResponse(
      503,
      "Unable to update your profile right now. Please try again.",
    );
  }
}
