import { NextResponse } from "next/server";

import { LAB_READ_ROLES, LAB_WRITE_ROLES, allowsHomeCollection, allowsLabVisit } from "@/config/labs";
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
import { toLabTestDto } from "@/lib/api/serializers";
import { LabDepartment } from "@/models/LabDepartment";
import { LabTest } from "@/models/LabTest";
import { Laboratory } from "@/models/Laboratory";
import { labTestIdSchema, labTestUpdateSchema } from "@/lib/validation/lab-test";
import { toFieldIssues } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

const POPULATE = "name code isActive";

/**
 * GET /api/lab-tests/[id]
 *
 * Single test record with laboratory and department references. Tests
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
  const parsedId = labTestIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid lab test id.");
  }

  try {
    await connectToDatabase();

    const test = await LabTest.findOne({
      _id: parsedId.data.id,
      ...scopeFilter(user),
    })
      .populate("laboratoryId", POPULATE)
      .populate("departmentId", POPULATE)
      .lean();
    if (!test) {
      return errorResponse(404, "Lab test not found.");
    }

    return itemResponse(toLabTestDto(test));
  } catch (error) {
    logApiFailure("lab-tests/[id]", error);
    return errorResponse(
      503,
      "Unable to load the lab test right now. Please try again.",
    );
  }
}

/**
 * PATCH /api/lab-tests/[id]
 *
 * Partial update. Whenever the laboratory or department changes, the
 * relationship is re-validated (both records active, department inside the
 * laboratory) and code uniqueness is re-checked within the target
 * laboratory. LAB_MANAGER may only touch tests in their scope, and may not
 * move a test into a laboratory outside their scope (404).
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
  const parsedId = labTestIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid lab test id.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = labTestUpdateSchema.safeParse(body);
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

    const test = await LabTest.findOne({
      _id: parsedId.data.id,
      ...scopeFilter(user),
    })
      .select(
        "laboratoryId departmentId code labVisitEnabled homeCollectionEnabled",
      )
      .lean();
    if (!test) {
      return errorResponse(404, "Lab test not found.");
    }

    // A test must always offer at least one sample collection method. Partial
    // updates only carry the changed flag, so the merged result is checked
    // against the stored document.
    if (
      "labVisitEnabled" in updates ||
      "homeCollectionEnabled" in updates
    ) {
      const mergedLabVisit =
        updates.labVisitEnabled !== undefined
          ? updates.labVisitEnabled
          : allowsLabVisit(test);
      const mergedHome =
        updates.homeCollectionEnabled !== undefined
          ? updates.homeCollectionEnabled
          : allowsHomeCollection(test);
      if (!mergedLabVisit && !mergedHome) {
        return errorResponse(
          400,
          "Enable at least one sample collection method (lab visit or home collection).",
          [
            {
              field: "labVisitEnabled",
              message:
                "Enable at least one sample collection method (lab visit or home collection).",
            },
          ],
        );
      }
    }

    const targetLabId =
      updates.laboratoryId !== undefined
        ? updates.laboratoryId
        : String(test.laboratoryId);
    const targetDeptId =
      updates.departmentId !== undefined
        ? updates.departmentId
        : String(test.departmentId);

    const relationshipChanged =
      (updates.laboratoryId !== undefined &&
        updates.laboratoryId !== String(test.laboratoryId)) ||
      (updates.departmentId !== undefined &&
        updates.departmentId !== String(test.departmentId));

    if (updates.laboratoryId !== undefined) {
      // Moving the test must stay inside the acting account's scope too.
      if (!isLaboratoryInScope(user, updates.laboratoryId)) {
        return errorResponse(404, "Laboratory not found.");
      }
    }

    if (relationshipChanged) {
      const laboratory = await Laboratory.findById(targetLabId)
        .select("_id isActive")
        .lean();
      if (!laboratory) {
        return errorResponse(404, "Laboratory not found.");
      }
      if (!laboratory.isActive) {
        return errorResponse(
          400,
          "Cannot assign the test to an inactive laboratory. Activate the laboratory first.",
        );
      }

      const department = await LabDepartment.findById(targetDeptId)
        .select("_id laboratoryId isActive")
        .lean();
      if (!department) {
        return errorResponse(404, "Department not found.");
      }
      if (String(department.laboratoryId) !== targetLabId) {
        return errorResponse(
          400,
          "The selected department does not belong to the selected laboratory.",
        );
      }
      if (!department.isActive) {
        return errorResponse(
          400,
          "Cannot assign the test to an inactive department. Activate the department first.",
        );
      }
    }

    if (updates.code !== undefined || relationshipChanged) {
      const code = updates.code ?? test.code;
      const duplicate = await LabTest.findOne({
        laboratoryId: targetLabId,
        code,
        _id: { $ne: parsedId.data.id },
      })
        .select("_id")
        .lean();
      if (duplicate) {
        return errorResponse(
          409,
          "A test with this code already exists in the target laboratory. Choose a different code.",
        );
      }
    }

    const updated = await LabTest.findByIdAndUpdate(
      parsedId.data.id,
      { $set: updates },
      { new: true, runValidators: true },
    )
      .populate("laboratoryId", POPULATE)
      .populate("departmentId", POPULATE)
      .lean();

    if (!updated) {
      return errorResponse(404, "Lab test not found.");
    }

    return itemResponse(toLabTestDto(updated));
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return errorResponse(
        409,
        "A test with this code already exists in the target laboratory. Choose a different code.",
      );
    }
    logApiFailure("lab-tests/[id]/update", error);
    return errorResponse(
      503,
      "Unable to update the lab test right now. Please try again.",
    );
  }
}
