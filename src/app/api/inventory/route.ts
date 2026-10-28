import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireRole } from "@/lib/auth";
import {
  isLaboratoryInScope,
  scopeFilter,
} from "@/lib/auth/laboratory-scope";
import { connectToDatabase } from "@/lib/db";
import {
  buildListMeta,
  errorResponse,
  itemResponse,
  listResponse,
  logApiFailure,
} from "@/lib/api/response";
import { toItemDto } from "@/lib/inventory/dto";
import { recoverStaleStockTransactions } from "@/lib/inventory/stock";
import { InventoryItem } from "@/models/InventoryItem";
import { containsRegex, toFieldIssues } from "@/lib/validation/common";
import {
  inventoryItemCreateSchema,
  inventoryListQuerySchema,
} from "@/lib/validation/inventory";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/** Inventory is a staff surface: patients/collectors/doctors get 403. */
const ROLES_ALLOWED = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
] as const;

/**
 * GET /api/inventory
 *
 * Laboratory-scoped stock list (legacy accounts see every lab, LM/STAFF
 * only theirs; an out-of-scope `laboratoryId` intersects to zero rows).
 * Filters: name search, category, `lowStock` (quantity <= reorderLevel,
 * via `$expr`) and `expiring` (expiry within the warning window or past).
 * Each read first runs the stale-PENDING recovery scan (documented
 * non-transactional strategy) so history can never stay half-finished.
 */
export async function GET(request: Request): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireRole(...ROLES_ALLOWED);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { searchParams } = new URL(request.url);
  const parsed = inventoryListQuerySchema.safeParse({
    search: searchParams.get("search") ?? undefined,
    category: searchParams.get("category") ?? undefined,
    lowStock: searchParams.get("lowStock") ?? undefined,
    expiring: searchParams.get("expiring") ?? undefined,
    laboratoryId: searchParams.get("laboratoryId") ?? undefined,
    page: searchParams.get("page") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your search parameters and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const { search, category, lowStock, expiring, laboratoryId, page, limit } =
    parsed.data;

  const filter: Record<string, unknown> = {};
  Object.assign(filter, scopeFilter(user));
  if (laboratoryId !== undefined) {
    filter.laboratoryId = isLaboratoryInScope(user, laboratoryId)
      ? laboratoryId
      : { $in: [] };
  }
  if (category !== undefined) filter.category = category;
  if (search) filter.name = containsRegex(search);
  if (lowStock === "true") {
    filter.$expr = { $lte: ["$quantity", "$reorderLevel"] };
  }
  if (expiring === "true") {
    const horizon = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    );
    filter.expiryDate = { $ne: null, $lte: horizon };
  }

  try {
    await connectToDatabase();

    await recoverStaleStockTransactions();

    const [total, docs] = await Promise.all([
      InventoryItem.countDocuments(filter),
      InventoryItem.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    return listResponse(
      docs.map((doc) => toItemDto(doc)),
      buildListMeta(page, limit, total),
    );
  } catch (error) {
    logApiFailure("inventory/list", error);
    return errorResponse(
      503,
      "Unable to load inventory right now. Please try again.",
    );
  }
}

/**
 * POST /api/inventory
 *
 * Creates an item at quantity 0 - stock never arrives through item create
 * (approved rule); the caller records an IN/ADJUST stock transaction so the
 * append-only history covers every unit from the first one. Cross-laboratory
 * targets answer 404.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireRole(...ROLES_ALLOWED);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = inventoryItemCreateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check the item details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const input = parsed.data;
  if (!isLaboratoryInScope(user, input.laboratoryId)) {
    return errorResponse(404, "Laboratory not found.");
  }

  try {
    await connectToDatabase();

    const expiry = input.expiryDate ?? null;
    const created = await InventoryItem.create({
      name: input.name,
      category: input.category,
      unit: input.unit,
      quantity: 0,
      reorderLevel: input.reorderLevel,
      expiryDate: expiry ? new Date(expiry) : null,
      laboratoryId: input.laboratoryId,
    });

    return itemResponse(toItemDto(created), 201);
  } catch (error) {
    logApiFailure("inventory/create", error);
    return errorResponse(
      503,
      "Unable to create the item right now. Please try again.",
    );
  }
}
