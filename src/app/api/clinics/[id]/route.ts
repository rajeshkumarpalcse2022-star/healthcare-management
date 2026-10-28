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
import { toClinicDto } from "@/lib/api/serializers";
import { Clinic } from "@/models/Clinic";
import {
  clinicIdSchema,
  clinicUpdateSchema,
} from "@/lib/validation/clinic";
import { toFieldIssues } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/**
 * GET /api/clinics/[id]
 *
 * Returns a single clinic. Requires SUPER_ADMIN or ADMIN.
 */
export async function GET(
  _request: Request,
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

  try {
    await connectToDatabase();

    const clinic = await Clinic.findById(parsedId.data.id).lean();
    if (!clinic) {
      return errorResponse(404, "Clinic not found.");
    }

    return itemResponse(toClinicDto(clinic));
  } catch (error) {
    logApiFailure("clinics/[id]", error);
    return errorResponse(
      503,
      "Unable to load the clinic right now. Please try again.",
    );
  }
}

/**
 * PATCH /api/clinics/[id]
 *
 * Partial update. Omitted keys stay unchanged; provided blank optional fields
 * clear their stored value. Code changes are uniqueness-checked.
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

  const parsed = clinicUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const updates = parsed.data;
  if (Object.keys(updates).length === 0) {
    return errorResponse(400, "No changes were provided.");
  }

  try {
    await connectToDatabase();

    const existing = await Clinic.findById(parsedId.data.id).select("_id code").lean();
    if (!existing) {
      return errorResponse(404, "Clinic not found.");
    }

    if (updates.code && updates.code !== existing.code) {
      const duplicate = await Clinic.findOne({ code: updates.code, _id: { $ne: existing._id } })
        .select("_id")
        .lean();
      if (duplicate) {
        return errorResponse(
          409,
          "A clinic with this code already exists. Choose a different code.",
        );
      }
    }

    const clinic = await Clinic.findByIdAndUpdate(
      parsedId.data.id,
      { $set: updates },
      { new: true, runValidators: true },
    ).lean();

    if (!clinic) {
      return errorResponse(404, "Clinic not found.");
    }

    return itemResponse(toClinicDto(clinic));
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return errorResponse(
        409,
        "A clinic with this code already exists. Choose a different code.",
      );
    }
    logApiFailure("clinics/[id]/update", error);
    return errorResponse(
      503,
      "Unable to update the clinic right now. Please try again.",
    );
  }
}
