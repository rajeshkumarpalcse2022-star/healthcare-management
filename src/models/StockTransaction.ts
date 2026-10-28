import { Schema } from "mongoose";

import {
  STOCK_TX_STATUSES,
  STOCK_TX_TYPES,
} from "@/config/inventory";
import { getModel } from "@/lib/db";

/**
 * StockTransaction - append-only history of every quantity change.
 *
 * Rows are never edited or deleted; `status` may advance PENDING -> APPLIED
 * or PENDING -> REJECTED exactly once (the recovery scan does this for rows
 * left stale by a crash on the non-transactional path - see
 * `src/config/inventory.ts` for the strategy). APPLIED/REJECTED are terminal.
 *
 * `delta` is signed: IN > 0, OUT < 0, ADJUST either. `quantityAfter` is the
 * item's quantity right after this change applied - the human-readable audit
 * trail that lets a reader reconstruct stock without replaying the ledger.
 */
export interface StockTransactionRecord {
  _id: string;
  itemId: string;
  laboratoryId: string;
  type: (typeof STOCK_TX_TYPES)[number];
  delta: number;
  quantityAfter: number | null;
  status: (typeof STOCK_TX_STATUSES)[number];
  performedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const stockTransactionSchema = new Schema<StockTransactionRecord>(
  {
    itemId: {
      type: String,
      required: true,
      index: true,
    },
    laboratoryId: {
      type: String,
      required: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: STOCK_TX_TYPES,
    },
    delta: {
      type: Number,
      required: true,
      validate: {
        validator: (value: number) => value !== 0,
        message: "Stock deltas must be non-zero.",
      },
    },
    quantityAfter: {
      type: Number,
      default: null,
    },
    status: {
      type: String,
      required: true,
      enum: STOCK_TX_STATUSES,
      default: "PENDING",
    },
    performedBy: {
      type: String,
      required: true,
    },
  },
  {
    timestamps: true,
    collection: "stocktransactions",
  },
);

stockTransactionSchema.index({ itemId: 1, createdAt: -1 });
// Partial index: the recovery scan only ever needs PENDING rows.
stockTransactionSchema.index(
  { status: 1, createdAt: 1 },
  { partialFilterExpression: { status: "PENDING" } },
);

/** Registered through the `getModel` helper (HMR-idempotent). */
export const StockTransaction = getModel<StockTransactionRecord>(
  "StockTransaction",
  stockTransactionSchema,
);
