import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { isLaboratoryInScope } from "@/lib/auth/laboratory-scope";
import { connectToDatabase } from "@/lib/db";
import {
  errorResponse,
  itemResponse,
  logApiFailure,
} from "@/lib/api/response";
import { toItemDto } from "@/lib/inventory/dto";
import { recoverStaleStockTransactions } from "@/lib/inventory/stock";
import { InventoryItem } from "@/models/InventoryItem";
import { toFieldIssues } from "@/lib/validation/common";
import {
  inventoryIdSchema,
  inventoryItemUpdateSchema,
} from "@/lib/validation/inventory";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

const READ_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
] as const;

const WRITE_ROLES = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
] as const;

/**
 * GET /api/inventory/[id]
 *
 * Item detail, laboratory-scoped (cross-lab -> 404). Runs the stale-PENDING
 * recovery scan first so a previously interrupted movement is finalised
 * before the quantity is rendered.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireRole(...READ_ROLES);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { id } = await params;
  const parsedId = inventoryIdSchema.safeParse({ id });
  if (!parsedId.success) return errorResponse(404, "Inventory item not found.");

  try {
    await connectToDatabase();

    await recoverStaleStockTransactions();

    const item = await InventoryItem.findById(parsedId.data.id).lean();
    if (!item || !isLaboratoryInScope(user, item.laboratoryId)) {
      return errorResponse(404, "Inventory item not found.");
    }

    return itemResponse(toItemDto(item));
  } catch (error) {
    logApiFailure("inventory/[id]", error);
    return errorResponse(
      503,
      "Unable to load the item right now. Please try again.",
    );
  }
}

/**
 * PATCH /api/inventory/[id]
 *
 * Metadata only (name, category, unit, reorder level, expiry). `quantity`
 * in the payload is rejected with a dedicated message - stock changes are
 * exclusively stock-transaction territory (approved P1-3 rule).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireRole(...WRITE_ROLES);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { id } = await params;
  const parsedId = inventoryIdSchema.safeParse({ id });
  if (!parsedId.success) return errorResponse(404, "Inventory item not found.");

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  if (Object.prototype.hasOwnProperty.call(body, "quantity")) {
    return errorResponse(
      400,
      "Quantity changes must be recorded as stock transactions.",
    );
  }

  const parsed = inventoryItemUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check the item details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const $set: Record<string, unknown> = {};
  const input = parsed.data;
  if (input.name !== undefined) $set.name = input.name;
  if (input.category !== undefined) $set.category = input.category;
  if (input.unit !== undefined) $set.unit = input.unit;
  if (input.reorderLevel !== undefined) $set.reorderLevel = input.reorderLevel;
  if (input.expiryDate !== undefined) {
    $set.expiryDate = input.expiryDate ? new Date(input.expiryDate) : null;
  }
  if (Object.keys($set).length === 0) {
    return errorResponse(400, "Provide at least one field to update.");
  }

  try {
    await connectToDatabase();

    const existing = await InventoryItem.findById(parsedId.data.id);
    if (!existing || !isLaboratoryInScope(user, existing.laboratoryId)) {
      return errorResponse(404, "Inventory item not found.");
    }

    const updated = await InventoryItem.findByIdAndUpdate(
      existing._id,
      { $set },
      { new: true },
    );
    if (!updated) return errorResponse(404, "Inventory item not found.");

    return itemResponse(toItemDto(updated));
  } catch (error) {
    logApiFailure("inventory/[id]/patch", error);
    return errorResponse(
      503,
      "Unable to update the item right now. Please try again.",
    );
  }
}
