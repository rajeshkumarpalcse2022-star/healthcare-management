import type { ClientSession } from "mongoose";

import { runInTransaction } from "@/lib/db/transaction";
import { InventoryItem, type InventoryItemRecord } from "@/models/InventoryItem";
import {
  StockTransaction,
  type StockTransactionRecord,
} from "@/models/StockTransaction";

/**
 * Stock engine - the ONLY code path that changes `InventoryItem.quantity`.
 *
 * Approved P1-3 consistency strategy (two modes, same observable result):
 *
 * WITH transactions (replica set / Atlas): the PENDING history row, the
 * guarded `$inc` and the APPLIED/REJECTED flip all commit or roll back
 * together inside `runInTransaction`.
 *
 * WITHOUT transactions (standalone mongod): writes run sequentially -
 *   1. insert the history row as PENDING;
 *   2. conditional apply: `findOneAndUpdate` filters on
 *      `{ quantity: { $gte: -delta } }` (insufficient-stock guard) and
 *      `{ appliedTxs: { $ne: txId } }` (per-transaction idempotency), so
 *      the quantity change itself is still atomic on the single document;
 *   3. flip the row to APPLIED or REJECTED.
 * A crash between steps leaves the row PENDING; `recoverStaleStockTransactions`
 * (invoked by list/detail reads) re-runs step 2-3 - safe because of the
 * `appliedTxs` guard, which turns any crash window into an idempotent
 * re-apply instead of a double-count. This is the documented recovery
 * strategy; deployments needing stricter guarantees should run a replica
 * set, where mode one applies.
 */

export type StockResult =
  | { ok: true; tx: StockTransactionRecord; quantityAfter: number }
  | { ok: false; code: 404 | 409; message: string; unit?: string };

/**
 * Finalises one history row: applies (idempotently) the row's delta to its
 * item, then flips PENDING -> APPLIED/REJECTED. Shared by the live path and
 * the recovery scan - never inserts a new row.
 */
async function finalizeStockRow(
  row: Pick<
    StockTransactionRecord,
    "_id" | "itemId" | "delta" | "status"
  >,
  session: ClientSession | null,
): Promise<StockResult> {
  const txId = String(row._id);

  const guard: Record<string, unknown> = {
    _id: row.itemId,
    appliedTxs: { $ne: txId },
  };
  if (row.delta < 0) guard.quantity = { $gte: -row.delta };

  // `new: true` returns the POST-image, so the history row records the
  // balance AFTER this movement - the pre-image would misreport it.
  const updated = await InventoryItem.findOneAndUpdate(
    guard,
    {
      $inc: { quantity: row.delta },
      $addToSet: { appliedTxs: txId },
      $set: { updatedAt: new Date() },
    },
    { new: true },
  ).session(session);

  if (updated) {
    const finalRow = await StockTransaction.findOneAndUpdate(
      { _id: row._id, status: "PENDING" },
      { $set: { status: "APPLIED", quantityAfter: updated.quantity } },
      { new: true, session },
    );
    return {
      ok: true,
      tx: (finalRow ?? row) as StockTransactionRecord,
      quantityAfter: updated.quantity,
    };
  }

  const current = await InventoryItem.findById(row.itemId).session(session);
  if (
    current &&
    Array.isArray(current.appliedTxs) &&
    current.appliedTxs.includes(txId)
  ) {
    // The $inc already happened in a previous attempt (crash window): just
    // finish the history row - never apply the delta a second time.
    const finalRow = await StockTransaction.findOneAndUpdate(
      { _id: row._id, status: "PENDING" },
      { $set: { status: "APPLIED", quantityAfter: current.quantity } },
      { new: true, session },
    );
    return {
      ok: true,
      tx: (finalRow ?? row) as StockTransactionRecord,
      quantityAfter: current.quantity,
    };
  }

  const message = !current
    ? "Inventory item not found."
    : `Insufficient stock: only ${current.quantity} ${current.unit} available.`;
  await StockTransaction.findOneAndUpdate(
    { _id: row._id, status: "PENDING" },
    {
      $set: {
        status: "REJECTED",
        quantityAfter: current ? current.quantity : null,
      },
    },
    { session },
  );
  return {
    ok: false,
    code: current ? 409 : 404,
    message,
    ...(current ? { unit: current.unit } : {}),
  };
}

/**
 * Records one stock movement. History row is written FIRST (status
 * PENDING, flipped within the same transaction when supported), so an
 * accepted movement can never exist without its append-only trail.
 *
 * Preconditions such as "EQUIPMENT cannot move OUT" are route-side checks
 * (they return 400 before any row exists).
 */
export async function recordStockChange(params: {
  item: Pick<InventoryItemRecord, "_id" | "laboratoryId" | "unit">;
  type: "IN" | "OUT" | "ADJUST";
  delta: number;
  userId: string;
}): Promise<StockResult> {
  const { item, type, delta, userId } = params;

  return runInTransaction(async (session) => {
    const [row] = await StockTransaction.create(
      [
        {
          itemId: String(item._id),
          laboratoryId: item.laboratoryId,
          type,
          delta,
          status: "PENDING",
          performedBy: userId,
        },
      ],
      { session },
    );
    return finalizeStockRow(row as unknown as StockTransactionRecord, session);
  });
}

/**
 * Recovery scan for stale PENDING rows (older than 30s - live requests are
 * long done by then). Idempotent by construction; invoked by inventory
 * list/detail reads as the self-healing half of the documented strategy.
 * Returns the number of rows it brought to a terminal state.
 */
export async function recoverStaleStockTransactions(): Promise<number> {
  const cutoff = new Date(Date.now() - 30_000);
  const stale = await StockTransaction.find({
    status: "PENDING",
    createdAt: { $lte: cutoff },
  })
    .limit(25)
    .lean();

  let healed = 0;
  for (const row of stale) {
    // Both terminal outcomes (APPLIED / REJECTED) count as healed; the
    // result is only observed for crash-safety, not for reporting.
    await finalizeStockRow(row as unknown as StockTransactionRecord, null);
    healed += 1;
  }
  return healed;
}
