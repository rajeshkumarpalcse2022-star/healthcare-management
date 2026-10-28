import { NextResponse } from "next/server";

import { LAB_WRITE_ROLES } from "@/config/labs";
import {
  authErrorResponse,
  requireRole,
  scopeFilter,
} from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import type { SafeUser } from "@/types/auth";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import { toDepartmentDto } from "@/lib/api/serializers";
import { LabDepartment } from "@/models/LabDepartment";
import {
  departmentIdSchema,
  departmentStatusSchema,
} from "@/lib/validation/lab-department";
import { toFieldIssues } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/lab-departments/[id]/status
 *
 * Activates or deactivates a department. Requires lab management roles;
 * departments outside a LAB_MANAGER's scope answer 404 (checked before the
 * write happens).
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
  const parsedId = departmentIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid department id.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = departmentStatusSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  try {
    await connectToDatabase();

    const owned = await LabDepartment.findOne({
      _id: parsedId.data.id,
      ...scopeFilter(user),
    })
      .select("_id")
      .lean();
    if (!owned) {
      return errorResponse(404, "Department not found.");
    }

    const department = await LabDepartment.findByIdAndUpdate(
      parsedId.data.id,
      { $set: { isActive: parsed.data.isActive } },
      { new: true, runValidators: true },
    )
      .populate("laboratoryId", "name code isActive")
      .lean();

    if (!department) {
      return errorResponse(404, "Department not found.");
    }

    return itemResponse(toDepartmentDto(department));
  } catch (error) {
    logApiFailure("lab-departments/[id]/status", error);
    return errorResponse(
      503,
      "Unable to update the department status right now. Please try again.",
    );
  }
}
