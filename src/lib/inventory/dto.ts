import { expiryState, LOW_STOCK_DEFAULT_REORDER } from "@/config/inventory";
import type { InventoryItemRecord } from "@/models/InventoryItem";
import type { StockTransactionRecord } from "@/models/StockTransaction";

/**
 * Inventory DTOs - API shapes for items and stock history.
 *
 * `lowStock` and `expiryState` are computed server-side so every client
 * (page, dashboard widget) reports identical indicators. History rows are
 * append-only serialisations: no editable view exists on purpose.
 */

export interface InventoryItemDto {
  id: string;
  name: string;
  category: string;
  unit: string;
  quantity: number;
  reorderLevel: number;
  lowStock: boolean;
  expiryDate: string | null;
  expiryState: "EXPIRED" | "EXPIRING" | "OK";
  laboratoryId: string;
  createdAt: string;
  updatedAt: string;
}

export function toItemDto(
  item: InventoryItemRecord & { _id: unknown },
): InventoryItemDto {
  const expiry = item.expiryDate ?? null;
  const reorder = item.reorderLevel ?? LOW_STOCK_DEFAULT_REORDER;
  return {
    id: String(item._id),
    name: item.name,
    category: item.category,
    unit: item.unit,
    quantity: item.quantity,
    reorderLevel: item.reorderLevel,
    lowStock: item.quantity <= reorder,
    expiryDate: expiry ? new Date(expiry).toISOString() : null,
    expiryState: expiryState(expiry),
    laboratoryId: item.laboratoryId,
    createdAt: new Date(item.createdAt).toISOString(),
    updatedAt: new Date(item.updatedAt).toISOString(),
  };
}

export interface StockTransactionDto {
  id: string;
  itemId: string;
  type: string;
  delta: number;
  quantityAfter: number | null;
  status: string;
  performedBy: string;
  performedByName: string | null;
  createdAt: string;
}

export function toTxDto(
  tx: StockTransactionRecord & { _id: unknown },
  actorName?: string | null,
): StockTransactionDto {
  return {
    id: String(tx._id),
    itemId: tx.itemId,
    type: tx.type,
    delta: tx.delta,
    quantityAfter: tx.quantityAfter,
    status: tx.status,
    performedBy: tx.performedBy,
    performedByName: actorName ?? null,
    createdAt: new Date(tx.createdAt).toISOString(),
  };
}
