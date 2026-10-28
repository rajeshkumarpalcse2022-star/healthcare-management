import { NextResponse } from "next/server";

import { LAB_READ_ROLES, LAB_WRITE_ROLES } from "@/config/labs";
import {
  authErrorResponse,
  isLaboratoryInScope,
  requireRole,
  scopeFilter,
} from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import type { SafeUser } from "@/types/auth";
import {
  errorResponse,
  isDuplicateKeyError,
  itemResponse,
  logApiFailure,
} from "@/lib/api/response";
import { toDepartmentDto } from "@/lib/api/serializers";
import { LabDepartment } from "@/models/LabDepartment";
import { Laboratory } from "@/models/Laboratory";
import {
  departmentIdSchema,
  departmentUpdateSchema,
} from "@/lib/validation/lab-department";
import { toFieldIssues } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

const LAB_FIELDS = "name code isActive";

/**
 * GET /api/lab-departments/[id]
 *
 * Single department record with its laboratory reference. Departments
 * outside a LAB_MANAGER/STAFF scope answer 404 (scope applied in the
 * query itself - no existence probing).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireRole(...LAB_READ_ROLES);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { id } = await params;
  const parsedId = departmentIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid department id.");
  }

  try {
    await connectToDatabase();

    const department = await LabDepartment.findOne({
      _id: parsedId.data.id,
      ...scopeFilter(user),
    })
      .populate("laboratoryId", LAB_FIELDS)
      .lean();
    if (!department) {
      return errorResponse(404, "Department not found.");
    }

    return itemResponse(toDepartmentDto(department));
  } catch (error) {
    logApiFailure("lab-departments/[id]", error);
    return errorResponse(
      503,
      "Unable to load the department right now. Please try again.",
    );
  }
}

/**
 * PATCH /api/lab-departments/[id]
 *
 * Partial update. When the laboratory changes, the target laboratory must
 * exist and be active, and the code must be unique within it. LAB_MANAGER
 * may only touch departments in their scope and may not move one into a
 * laboratory outside their scope (404).
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

  const parsed = departmentUpdateSchema.safeParse(body);
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

    const department = await LabDepartment.findOne({
      _id: parsedId.data.id,
      ...scopeFilter(user),
    })
      .select("laboratoryId code")
      .lean();
    if (!department) {
      return errorResponse(404, "Department not found.");
    }

    const targetLabId =
      updates.laboratoryId !== undefined
        ? updates.laboratoryId
        : String(department.laboratoryId);
    const movingLaboratory =
      updates.laboratoryId !== undefined &&
      updates.laboratoryId !== String(department.laboratoryId);

    if (movingLaboratory) {
      if (!isLaboratoryInScope(user, targetLabId)) {
        return errorResponse(404, "Laboratory not found.");
      }
      const laboratory = await Laboratory.findById(targetLabId)
        .select("_id isActive")
        .lean();
      if (!laboratory) {
        return errorResponse(404, "Laboratory not found.");
      }
      if (!laboratory.isActive) {
        return errorResponse(
          400,
          "Cannot move a department to an inactive laboratory. Activate the laboratory first.",
        );
      }
    }

    if (updates.code !== undefined || movingLaboratory) {
      const code = updates.code ?? department.code;
      const duplicate = await LabDepartment.findOne({
        laboratoryId: targetLabId,
        code,
        _id: { $ne: parsedId.data.id },
      })
        .select("_id")
        .lean();
      if (duplicate) {
        return errorResponse(
          409,
          "A department with this code already exists in the target laboratory. Choose a different code.",
        );
      }
    }

    const updated = await LabDepartment.findByIdAndUpdate(
      parsedId.data.id,
      { $set: updates },
      { new: true, runValidators: true },
    )
      .populate("laboratoryId", LAB_FIELDS)
      .lean();

    if (!updated) {
      return errorResponse(404, "Department not found.");
    }

    return itemResponse(toDepartmentDto(updated));
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return errorResponse(
        409,
        "A department with this code already exists in the target laboratory. Choose a different code.",
      );
    }
    logApiFailure("lab-departments/[id]/update", error);
    return errorResponse(
      503,
      "Unable to update the department right now. Please try again.",
    );
  }
}
