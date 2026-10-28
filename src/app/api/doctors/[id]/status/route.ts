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
import { doctorIdSchema, doctorStatusSchema } from "@/lib/validation/doctor";
import { toFieldIssues } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/doctors/[id]/status
 *
 * Activates or deactivates a doctor profile. Requires SUPER_ADMIN or ADMIN.
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
  const parsedId = doctorIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid doctor id.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = doctorStatusSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  try {
    await connectToDatabase();

    const doctor = await Doctor.findByIdAndUpdate(
      parsedId.data.id,
      { $set: { isActive: parsed.data.isActive } },
      { new: true, runValidators: true },
    )
      .populate("clinicId", "name code city isActive imageUrl latitude longitude")
      .lean();

    if (!doctor) {
      return errorResponse(404, "Doctor not found.");
    }

    return itemResponse(toDoctorDto(doctor));
  } catch (error) {
    logApiFailure("doctors/[id]/status", error);
    return errorResponse(
      503,
      "Unable to update the doctor status right now. Please try again.",
    );
  }
}
