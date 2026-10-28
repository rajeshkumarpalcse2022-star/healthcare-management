import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import {
  errorResponse,
  itemResponse,
  logApiFailure,
} from "@/lib/api/response";
import { User } from "@/models/User";
import { PatientProfile } from "@/models/PatientProfile";
import { toFieldIssues } from "@/lib/validation/common";
import { patientStatusSchema } from "@/lib/validation/patient";
import { toPatientDto } from "@/lib/patient/dto";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/patients/[id]/status
 *
 * Record-level activate / deactivate (ADMIN / SUPER_ADMIN only). Upserts the
 * profile row, so deactivating a legacy account with no profile yet simply
 * creates one carrying `isActive:false` plus null demographics. Deactivation
 * hides the patient from staff pickers and blocks NEW bookings and home
 * collections; existing history is never touched. Login remains governed
 * separately by `User.isActive` on the /api/users surface.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = patientStatusSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check the record status and try again.",
      toFieldIssues(parsed.error),
    );
  }

  try {
    await connectToDatabase();

    const user = await User.findOne({ _id: id, role: ROLES.PATIENT }).lean();
    if (!user) {
      return errorResponse(404, "Patient not found.");
    }

    const profile = await PatientProfile.findOneAndUpdate(
      { userId: user._id },
      { $set: { isActive: parsed.data.isActive } },
      { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
    ).lean();

    return itemResponse(toPatientDto(user, profile));
  } catch (error) {
    logApiFailure("patients/[id]/status", error);
    return errorResponse(
      503,
      "Unable to update the record status right now. Please try again.",
    );
  }
}
