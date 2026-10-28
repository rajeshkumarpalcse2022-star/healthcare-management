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
import { toLabTestDto } from "@/lib/api/serializers";
import { LabTest } from "@/models/LabTest";
import { labTestIdSchema, labTestStatusSchema } from "@/lib/validation/lab-test";
import { toFieldIssues } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

const POPULATE = "name code isActive";

/**
 * PATCH /api/lab-tests/[id]/status
 *
 * Activates or deactivates a test. Requires lab management roles; tests
 * outside a LAB_MANAGER's scope answer 404 (scope applied in the lookup
 * itself, before any write happens).
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

  const parsed = labTestStatusSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  try {
    await connectToDatabase();

    const owned = await LabTest.findOne({
      _id: parsedId.data.id,
      ...scopeFilter(user),
    })
      .select("_id")
      .lean();
    if (!owned) {
      return errorResponse(404, "Lab test not found.");
    }

    const test = await LabTest.findByIdAndUpdate(
      parsedId.data.id,
      { $set: { isActive: parsed.data.isActive } },
      { new: true, runValidators: true },
    )
      .populate("laboratoryId", POPULATE)
      .populate("departmentId", POPULATE)
      .lean();

    if (!test) {
      return errorResponse(404, "Lab test not found.");
    }

    return itemResponse(toLabTestDto(test));
  } catch (error) {
    logApiFailure("lab-tests/[id]/status", error);
    return errorResponse(
      503,
      "Unable to update the lab test status right now. Please try again.",
    );
  }
}
