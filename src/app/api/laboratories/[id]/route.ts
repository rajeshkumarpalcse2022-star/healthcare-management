import { NextResponse } from "next/server";

import { LAB_READ_ROLES, LAB_WRITE_ROLES } from "@/config/labs";
import {
  authErrorResponse,
  isLaboratoryInScope,
  requireRole,
} from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import type { SafeUser } from "@/types/auth";
import {
  errorResponse,
  isDuplicateKeyError,
  itemResponse,
  logApiFailure,
} from "@/lib/api/response";
import { toLaboratoryDto } from "@/lib/api/serializers";
import { Laboratory } from "@/models/Laboratory";
import {
  laboratoryIdSchema,
  laboratoryUpdateSchema,
} from "@/lib/validation/laboratory";
import { toFieldIssues } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/**
 * GET /api/laboratories/[id]
 *
 * Single laboratory record for the detail view. Out-of-scope laboratories
 * answer 404 for LAB_MANAGER/STAFF (no existence probing).
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
  const parsedId = laboratoryIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid laboratory id.");
  }
  if (!isLaboratoryInScope(user, parsedId.data.id)) {
    return errorResponse(404, "Laboratory not found.");
  }

  try {
    await connectToDatabase();

    const laboratory = await Laboratory.findById(parsedId.data.id).lean();
    if (!laboratory) {
      return errorResponse(404, "Laboratory not found.");
    }

    return itemResponse(toLaboratoryDto(laboratory));
  } catch (error) {
    logApiFailure("laboratories/[id]", error);
    return errorResponse(
      503,
      "Unable to load the laboratory right now. Please try again.",
    );
  }
}

/**
 * PATCH /api/laboratories/[id]
 *
 * Partial update. Omitted keys stay unchanged; duplicate codes are rejected
 * with 409 (excluding the record itself). LAB_MANAGER may only update
 * laboratories inside their scope; others get 404 (no existence probing).
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

  const parsed = laboratoryUpdateSchema.safeParse(body);
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

  // `bookingConfig: null` clears the booking configuration entirely ($unset),
  // an object replaces it ($set), and an omitted key leaves it unchanged.
  // `homeCollectionConfig` follows the same three-state contract.
  const { bookingConfig, homeCollectionConfig, ...restUpdates } = updates;
  const setDocument: Record<string, unknown> = { ...restUpdates };
  const unsetDocument: Record<string, ""> = {};
  if (bookingConfig === null) {
    unsetDocument.bookingConfig = "";
  } else if (bookingConfig !== undefined) {
    setDocument.bookingConfig = bookingConfig;
  }
  if (homeCollectionConfig === null) {
    unsetDocument.homeCollectionConfig = "";
  } else if (homeCollectionConfig !== undefined) {
    setDocument.homeCollectionConfig = homeCollectionConfig;
  }
  const updateOperations: Record<string, unknown> = {};
  if (Object.keys(setDocument).length > 0) {
    updateOperations.$set = setDocument;
  }
  if (Object.keys(unsetDocument).length > 0) {
    updateOperations.$unset = unsetDocument;
  }
  if (Object.keys(updateOperations).length === 0) {
    return errorResponse(400, "No changes were provided.");
  }

  try {
    await connectToDatabase();

    const laboratory = await Laboratory.findById(parsedId.data.id).select("_id");
    if (!laboratory) {
      return errorResponse(404, "Laboratory not found.");
    }

    if (updates.code !== undefined) {
      const duplicate = await Laboratory.findOne({
        code: updates.code,
        _id: { $ne: parsedId.data.id },
      })
        .select("_id")
        .lean();
      if (duplicate) {
        return errorResponse(
          409,
          "A laboratory with this code already exists. Choose a different code.",
        );
      }
    }

    const updated = await Laboratory.findByIdAndUpdate(
      parsedId.data.id,
      updateOperations,
      { new: true, runValidators: true },
    ).lean();

    if (!updated) {
      return errorResponse(404, "Laboratory not found.");
    }

    return itemResponse(toLaboratoryDto(updated));
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return errorResponse(
        409,
        "A laboratory with this code already exists. Choose a different code.",
      );
    }
    logApiFailure("laboratories/[id]/update", error);
    return errorResponse(
      503,
      "Unable to update the laboratory right now. Please try again.",
    );
  }
}
