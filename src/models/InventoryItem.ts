import { Schema } from "mongoose";

import {
  INVENTORY_CATEGORIES,
  INVENTORY_UNITS,
} from "@/config/inventory";
import { getModel } from "@/lib/db";

/**
 * InventoryItem - one stock row per item per laboratory.
 *
 * APPROVED P1-3 rules baked into this schema:
 * - `quantity` is schema-monitored but NEVER written by item create/update
 *   routes; only stock transactions touch it (conditional `$inc` guards, or
 *   a transaction when the deployment supports one). Clamp `min: 0` is the
 *   last-resort backstop, the real guard is the conditional update filter.
 * - one `expiryDate` per row (no lot/batch sub-records in scope);
 * - laboratory-scoped; cross-laboratory access resolves to 404 route-side.
 *
 * `appliedTxs` holds stock-transaction ids whose `$inc` already hit this
 * document. It makes the non-transactional apply + recovery scan idempotent:
 * the conditional update filters on `{ appliedTxs: { $ne: txId } }`, so a
 * crash between "quantity changed" and "history row marked APPLIED" can be
 * safely re-run without double-counting.
 */
export interface InventoryItemRecord {
  _id: string;
  name: string;
  category: (typeof INVENTORY_CATEGORIES)[number];
  unit: (typeof INVENTORY_UNITS)[number];
  quantity: number;
  reorderLevel: number;
  expiryDate: Date | null;
  laboratoryId: string;
  appliedTxs: string[];
  createdAt: Date;
  updatedAt: Date;
}

const inventoryItemSchema = new Schema<InventoryItemRecord>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120,
    },
    category: {
      type: String,
      required: true,
      enum: INVENTORY_CATEGORIES,
    },
    unit: {
      type: String,
      required: true,
      enum: INVENTORY_UNITS,
    },
    quantity: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    reorderLevel: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    expiryDate: {
      type: Date,
      default: null,
    },
    laboratoryId: {
      type: String,
      required: true,
      index: true,
    },
    appliedTxs: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
    collection: "inventoryitems",
  },
);

inventoryItemSchema.index({ laboratoryId: 1, category: 1 });
inventoryItemSchema.index({ laboratoryId: 1, name: 1 });

/** Registered through the `getModel` helper (HMR-idempotent). */
export const InventoryItem = getModel<InventoryItemRecord>(
  "InventoryItem",
  inventoryItemSchema,
);
