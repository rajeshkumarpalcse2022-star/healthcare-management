import { NextResponse } from "next/server";

import { LAB_READ_ROLES, LAB_WRITE_ROLES } from "@/config/labs";
import {
  authErrorResponse,
  requireRole,
  resolveLaboratoryScope,
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
import { toParameterDto } from "@/lib/api/serializers";
import { LabTest } from "@/models/LabTest";
import { LabTestParameter } from "@/models/LabTestParameter";
import {
  parameterIdSchema,
  parameterUpdateSchema,
} from "@/lib/validation/lab-test-parameter";
import { toFieldIssues } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/**
 * Parameters carry no `laboratoryId` of their own - scope is inherited from
 * the parent test. Unscoped accounts skip the probe entirely; scoped
 * accounts get `false` (-> 404, no probing) when the parent test lies
 * outside their laboratories.
 */
async function parentTestInScope(
  parameter: { labTestId: unknown },
  user: SafeUser,
): Promise<boolean> {
  if (resolveLaboratoryScope(user) === null) return true;
  const parent = await LabTest.findOne({
    _id: parameter.labTestId,
    ...scopeFilter(user),
  })
    .select("_id")
    .lean();
  return parent !== null;
}

/**
 * GET /api/lab-test-parameters/[id]
 *
 * Single parameter record, scoped through its parent test (404 for
 * out-of-scope laboratories).
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
  const parsedId = parameterIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid parameter id.");
  }

  try {
    await connectToDatabase();

    const parameter = await LabTestParameter.findById(parsedId.data.id).lean();
    if (!parameter) {
      return errorResponse(404, "Parameter not found.");
    }
    if (!(await parentTestInScope(parameter, user))) {
      return errorResponse(404, "Parameter not found.");
    }

    return itemResponse(toParameterDto(parameter));
  } catch (error) {
    logApiFailure("lab-test-parameters/[id]", error);
    return errorResponse(
      503,
      "Unable to load the parameter right now. Please try again.",
    );
  }
}

/**
 * PATCH /api/lab-test-parameters/[id]
 *
 * Partial update. When `displayOrder` is provided the parameter is moved to
 * that position and the whole list is renumbered 1..n, so no two parameters
 * can ever share a position. Scope is inherited from the parent test (404
 * for LAB_MANAGER/STAFF outside their laboratories).
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
  const parsedId = parameterIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid parameter id.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = parameterUpdateSchema.safeParse(body);
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

    const parameter = await LabTestParameter.findById(parsedId.data.id)
      .select("labTestId code displayOrder")
      .lean();
    if (!parameter) {
      return errorResponse(404, "Parameter not found.");
    }
    if (!(await parentTestInScope(parameter, user))) {
      return errorResponse(404, "Parameter not found.");
    }

    if (updates.code !== undefined && updates.code !== parameter.code) {
      const duplicate = await LabTestParameter.findOne({
        labTestId: parameter.labTestId,
        code: updates.code,
        _id: { $ne: parsedId.data.id },
      })
        .select("_id")
        .lean();
      if (duplicate) {
        return errorResponse(
          409,
          "A parameter with this code already exists for this test. Choose a different code.",
        );
      }
    }

    const requestedOrder = updates.displayOrder;
    if (requestedOrder !== undefined) {
      // Move this parameter to the requested position, then renumber the
      // whole list sequentially so displayOrder values stay contiguous.
      const siblings = await LabTestParameter.find({
        labTestId: parameter.labTestId,
      })
        .sort({ displayOrder: 1, createdAt: 1 })
        .select("_id displayOrder")
        .lean();

      const withoutCurrent = siblings.filter(
        (sibling) => String(sibling._id) !== parsedId.data.id,
      );
      const targetIndex = Math.min(
        Math.max(requestedOrder - 1, 0),
        withoutCurrent.length,
      );

      const reordered = [
        ...withoutCurrent.slice(0, targetIndex),
        { _id: parsedId.data.id, displayOrder: 0 },
        ...withoutCurrent.slice(targetIndex),
      ];

      const bulkOps = reordered
        .map((entry, index) => ({
          updateOne: {
            filter: { _id: entry._id },
            update: { $set: { displayOrder: index + 1 } },
          },
        }))
        .filter((op, index) => {
          const entry = reordered[index];
          if (String(entry._id) === parsedId.data.id) return true;
          return (
            siblings.find((s) => String(s._id) === String(entry._id))
              ?.displayOrder !== index + 1
          );
        });

      if (bulkOps.length > 0) {
        await LabTestParameter.bulkWrite(bulkOps);
      }
    }

    // displayOrder was already applied above; only scalar fields remain.
    const scalarUpdates: Record<string, unknown> = { ...updates };
    delete scalarUpdates.displayOrder;
    if (Object.keys(scalarUpdates).length > 0) {
      await LabTestParameter.findByIdAndUpdate(
        parsedId.data.id,
        { $set: scalarUpdates },
        { new: true, runValidators: true },
      );
    }

    const updated = await LabTestParameter.findById(parsedId.data.id).lean();
    if (!updated) {
      return errorResponse(404, "Parameter not found.");
    }

    return itemResponse(toParameterDto(updated));
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return errorResponse(
        409,
        "A parameter with this code already exists for this test. Choose a different code.",
      );
    }
    logApiFailure("lab-test-parameters/[id]/update", error);
    return errorResponse(
      503,
      "Unable to update the parameter right now. Please try again.",
    );
  }
}

/**
 * DELETE /api/lab-test-parameters/[id]
 *
 * Removes a parameter from its test. Remaining parameters are renumbered so
 * the list stays contiguous. Scope is inherited from the parent test (404
 * outside a LAB_MANAGER's laboratories) - checked before any write.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireRole(...LAB_WRITE_ROLES);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { id } = await params;
  const parsedId = parameterIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid parameter id.");
  }

  try {
    await connectToDatabase();

    const parameter = await LabTestParameter.findById(parsedId.data.id)
      .select("labTestId")
      .lean();
    if (!parameter) {
      return errorResponse(404, "Parameter not found.");
    }
    if (!(await parentTestInScope(parameter, user))) {
      return errorResponse(404, "Parameter not found.");
    }

    const deleted = await LabTestParameter.findByIdAndDelete(
      parsedId.data.id,
    ).lean();
    if (!deleted) {
      return errorResponse(404, "Parameter not found.");
    }

    // Close the gap left behind so displayOrder stays 1..n.
    const remaining = await LabTestParameter.find({
      labTestId: parameter.labTestId,
    })
      .sort({ displayOrder: 1, createdAt: 1 })
      .select("_id displayOrder")
      .lean();

    const bulkOps = remaining
      .map((entry, index) => ({
        updateOne: {
          filter: { _id: entry._id },
          update: { $set: { displayOrder: index + 1 } },
        },
      }))
      .filter((op, index) => remaining[index].displayOrder !== index + 1);

    if (bulkOps.length > 0) {
      await LabTestParameter.bulkWrite(bulkOps);
    }

    return itemResponse({ id: parsedId.data.id, deleted: true });
  } catch (error) {
    logApiFailure("lab-test-parameters/[id]/delete", error);
    return errorResponse(
      503,
      "Unable to delete the parameter right now. Please try again.",
    );
  }
}
