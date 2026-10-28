import { NextResponse } from "next/server";

import { LAB_WRITE_ROLES } from "@/config/labs";
import {
  authErrorResponse,
  isLaboratoryInScope,
  requireRole,
} from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import type { SafeUser } from "@/types/auth";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import { toLaboratoryDto } from "@/lib/api/serializers";
import { Laboratory } from "@/models/Laboratory";
import {
  laboratoryIdSchema,
  laboratoryStatusSchema,
} from "@/lib/validation/laboratory";
import { toFieldIssues } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/laboratories/[id]/status
 *
 * Activates or deactivates a laboratory. Requires lab management roles;
 * LAB_MANAGER is limited to laboratories in their scope (404 otherwise).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireRole(...LAB_WRITE_ROLES);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { id } = await params;
  const parsedId = laboratoryIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid laboratory id.");
  }
  if (!isLaboratoryInScope(user, parsedId.data.id)) {
    return errorResponse(404, "Laboratory not found.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = laboratoryStatusSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  try {
    await connectToDatabase();

    const laboratory = await Laboratory.findByIdAndUpdate(
      parsedId.data.id,
      { $set: { isActive: parsed.data.isActive } },
      { new: true, runValidators: true },
    ).lean();

    if (!laboratory) {
      return errorResponse(404, "Laboratory not found.");
    }

    return itemResponse(toLaboratoryDto(laboratory));
  } catch (error) {
    logApiFailure("laboratories/[id]/status", error);
    return errorResponse(
      503,
      "Unable to update the laboratory status right now. Please try again.",
    );
  }
}
