/**
 * Inventory & stock configuration (P1-3, approved decisions).
 *
 * Categories, units and stock-transaction types are closed enums: adding a
 * value later is a schema decision, not a runtime free-for-all. Quantity is
 * NEVER edited through item create/update - it only changes through stock
 * transactions (see `src/app/api/inventory`), which keeps the append-only
 * history complete.
 */

/** What kind of thing is stocked. */
export const INVENTORY_CATEGORIES = [
  "CONSUMABLE",
  "REAGENT",
  "EQUIPMENT",
  "OTHER",
] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

/** Closed unit set (approved): pieces, packaging, liquids by volume/weight. */
export const INVENTORY_UNITS = [
  "PIECE",
  "BOX",
  "VIAL",
  "ML",
  "L",
  "G",
  "KG",
] as const;
export type InventoryUnit = (typeof INVENTORY_UNITS)[number];

/**
 * Stock movement types:
 * - IN:     received into stock (delta > 0);
 * - OUT:    consumed from stock  (delta < 0, conditional decrement);
 * - ADJUST: manual correction either way (e.g. cycle count), same guards.
 *
 * EQUIPMENT may receive stock IN but is never decremented OUT (fixed assets
 * are counted, not consumed) - enforced route-side with a specific message.
 */
export const STOCK_TX_TYPES = ["IN", "OUT", "ADJUST"] as const;
export type StockTxType = (typeof STOCK_TX_TYPES)[number];

/**
 * Lifecycle of a history row on deployments WITHOUT multi-document
 * transactions (see `src/lib/db/transaction.ts`):
 *
 * - PENDING:  row written first; the item's conditional $inc may or may not
 *   have happened yet (crash window);
 * - APPLIED:  the (idempotent, per-tx) quantity change is confirmed;
 * - REJECTED: the guard failed (insufficient stock) - row kept as proof of
 *   the failed attempt, quantity untouched.
 *
 * With transactions support the row is written APPLIED inside the same
 * transaction as the quantity change, so PENDING only ever exists on the
 * fallback path. The recovery scan on list/detail reads re-runs any stale
 * PENDING row to APPLIED/REJECTED (idempotent via the item's `appliedTxs`
 * guard) - the "recoverable consistency strategy" documented for P1-3.
 */
export const STOCK_TX_STATUSES = ["PENDING", "APPLIED", "REJECTED"] as const;
export type StockTxStatus = (typeof STOCK_TX_STATUSES)[number];

/** Items at or below their reorder level are flagged `lowStock`. */
export const LOW_STOCK_DEFAULT_REORDER = 10;

/** Expiry flag window: dates within this many days warn, past dates expire. */
export const EXPIRY_WARNING_DAYS = 30;

/** `EXPIRING` / `EXPIRED` / `OK` indicator for list rows and detail headers. */
export type ExpiryState = "EXPIRED" | "EXPIRING" | "OK";

export function expiryState(
  expiryDate: Date | string | null | undefined,
  now: Date = new Date(),
): ExpiryState {
  if (!expiryDate) return "OK";
  const time = new Date(expiryDate).getTime();
  if (Number.isNaN(time)) return "OK";
  if (time < now.getTime()) return "EXPIRED";
  const window = EXPIRY_WARNING_DAYS * 24 * 60 * 60 * 1000;
  return time - now.getTime() <= window ? "EXPIRING" : "OK";
}
