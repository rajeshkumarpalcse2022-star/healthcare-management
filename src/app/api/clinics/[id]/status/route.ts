import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import {
  errorResponse,
  itemResponse,
  logApiFailure,
} from "@/lib/api/response";
import { toClinicDto } from "@/lib/api/serializers";
import { Clinic } from "@/models/Clinic";
import { clinicIdSchema, clinicStatusSchema } from "@/lib/validation/clinic";
import { toFieldIssues } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/clinics/[id]/status
 *
 * Activates or deactivates a clinic. Requires SUPER_ADMIN or ADMIN.
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
  const parsedId = clinicIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid clinic id.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = clinicStatusSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  try {
    await connectToDatabase();

    const clinic = await Clinic.findByIdAndUpdate(
      parsedId.data.id,
      { $set: { isActive: parsed.data.isActive } },
      { new: true, runValidators: true },
    ).lean();

    if (!clinic) {
      return errorResponse(404, "Clinic not found.");
    }

    return itemResponse(toClinicDto(clinic));
  } catch (error) {
    logApiFailure("clinics/[id]/status", error);
    return errorResponse(
      503,
      "Unable to update the clinic status right now. Please try again.",
    );
  }
}
