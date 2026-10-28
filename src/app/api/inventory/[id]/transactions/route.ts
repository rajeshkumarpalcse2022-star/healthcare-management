import { NextResponse } from "next/server";
import { isValidObjectId } from "mongoose";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { isLaboratoryInScope } from "@/lib/auth/laboratory-scope";
import { connectToDatabase } from "@/lib/db";
import {
  buildListMeta,
  errorResponse,
  itemResponse,
  listResponse,
  logApiFailure,
} from "@/lib/api/response";
import { toItemDto, toTxDto } from "@/lib/inventory/dto";
import {
  recoverStaleStockTransactions,
  recordStockChange,
} from "@/lib/inventory/stock";
import { InventoryItem } from "@/models/InventoryItem";
import { StockTransaction } from "@/models/StockTransaction";
import { User } from "@/models/User";
import { toFieldIssues, paginationSchema } from "@/lib/validation/common";
import {
  inventoryIdSchema,
  stockTxCreateSchema,
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
 * GET /api/inventory/[id]/transactions
 *
 * Append-only movement history for one item (laboratory-scoped; cross-lab
 * -> 404). Actor names are resolved in one batch; recovery scan runs first
 * so interrupted movements show their terminal state instead of PENDING.
 */
export async function GET(
  request: Request,
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

  const { searchParams } = new URL(request.url);
  const parsedQuery = paginationSchema.safeParse({
    page: searchParams.get("page") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });
  if (!parsedQuery.success) {
    return errorResponse(
      400,
      "Check your search parameters and try again.",
      toFieldIssues(parsedQuery.error),
    );
  }
  const { page, limit } = parsedQuery.data;

  try {
    await connectToDatabase();

    await recoverStaleStockTransactions();

    const item = await InventoryItem.findById(parsedId.data.id).lean();
    if (!item || !isLaboratoryInScope(user, item.laboratoryId)) {
      return errorResponse(404, "Inventory item not found.");
    }

    const filter = { itemId: String(item._id) };
    const [total, docs] = await Promise.all([
      StockTransaction.countDocuments(filter),
      StockTransaction.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const actorIds = [
      ...new Set(docs.map((doc) => String(doc.performedBy))),
    ].filter((id) => isValidObjectId(id));
    const actors = actorIds.length
      ? await User.find({ _id: { $in: actorIds } }).select("name").lean()
      : [];
    const actorNames = new Map(
      actors.map((actor) => [String(actor._id), actor.name ?? null]),
    );

    return listResponse(
      docs.map((doc) =>
        toTxDto(doc, actorNames.get(String(doc.performedBy)) ?? null),
      ),
      buildListMeta(page, limit, total),
    );
  } catch (error) {
    logApiFailure("inventory/transactions/list", error);
    return errorResponse(
      503,
      "Unable to load stock history right now. Please try again.",
    );
  }
}

/**
 * POST /api/inventory/[id]/transactions
 *
 * The ONLY endpoint that changes `InventoryItem.quantity`. Guards, in order:
 * laboratory scope (404), then EQUIPMENT can never move OUT (400), then
 * schema-validated signed delta (IN > 0, OUT < 0, ADJUST either, never 0),
 * then the engine's conditional decrement (insufficient stock -> 409 with
 * the remaining quantity; cross-lab race -> still 404 via the pre-read).
 * History row is appended before the quantity move (PENDING, finalised
 * inside the transaction when supported - see `src/lib/inventory/stock.ts`).
 */
export async function POST(
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const raw = (body ?? {}) as Record<string, unknown>;
  const parsed = stockTxCreateSchema.safeParse({ ...raw, itemId: parsedId.data.id });
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check the stock movement and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const input = parsed.data;

  try {
    await connectToDatabase();

    const item = await InventoryItem.findById(parsedId.data.id);
    if (!item || !isLaboratoryInScope(user, item.laboratoryId)) {
      return errorResponse(404, "Inventory item not found.");
    }

    if (input.type === "OUT" && item.category === "EQUIPMENT") {
      return errorResponse(
        400,
        "Equipment stock cannot be moved OUT - count corrections use ADJUST.",
      );
    }

    const result = await recordStockChange({
      item,
      type: input.type,
      delta: input.delta,
      userId: user.id,
    });

    if (!result.ok) {
      return errorResponse(result.code, result.message);
    }

    const fresh = await InventoryItem.findById(item._id).lean();
    return itemResponse(
      {
        transaction: toTxDto(result.tx, user.name ?? null),
        item: fresh ? toItemDto(fresh) : toItemDto(item),
      },
      201,
    );
  } catch (error) {
    logApiFailure("inventory/transactions/create", error);
    return errorResponse(
      503,
      "Unable to record the stock movement right now. Please try again.",
    );
  }
}
