import { Schema, type HydratedDocument, type Types } from "mongoose";

import { getModel } from "@/lib/db";
import {
  INVOICE_CODE_PATTERN,
  INVOICE_SOURCE_TYPES,
  INVOICE_STATUSES,
} from "@/config/billing";

/**
 * Invoice - immutable-snapshot internal ledger record (P1-2).
 *
 * Prices, items, patient and laboratory identity are COPIED from the source
 * booking/collection (or supplied for MANUAL invoices) at creation time and
 * never re-derived from live catalogue data, so catalogue edits or booking
 * mutations cannot change historical invoices. All arithmetic (totals,
 * balance) is validated and computed server-side before insert.
 *
 * Balance is never stored - it is recomputed from the `Payment` ledger on
 * every read (see `lib/billing/balance.ts`), so no crash between writes can
 * leave a stale outstanding amount.
 *
 * `activeSourceKey` mirrors `sourceKey` while the invoice is non-VOID and is
 * nulled on VOID: the partial unique index on it enforces "one live invoice
 * per source" (MongoDB partial indexes cannot express `!=` in
 * `partialFilterExpression`, hence the mirrored column) while VOID invoices
 * retain their historical `sourceKey`.
 */
export interface InvoiceItemSnapshot {
  labTestId: Types.ObjectId | null;
  description: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface InvoiceRecord {
  invoiceCode: string;
  patientId: Types.ObjectId;
  laboratoryId: Types.ObjectId;
  sourceType: (typeof INVOICE_SOURCE_TYPES)[number];
  sourceId: Types.ObjectId | null;
  sourceKey: string | null;
  activeSourceKey: string | null;
  items: InvoiceItemSnapshot[];
  subtotal: number;
  totalAmount: number;
  status: (typeof INVOICE_STATUSES)[number];
  notes: string | null;
  voidReason: string | null;
  createdBy: Types.ObjectId;
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const invoiceItemSchema = new Schema<InvoiceItemSnapshot>(
  {
    labTestId: {
      type: Schema.Types.ObjectId,
      ref: "LabTest",
      default: null,
    },
    description: { type: String, required: true, trim: true },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const invoiceSchema = new Schema<InvoiceRecord>(
  {
    invoiceCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      match: [INVOICE_CODE_PATTERN, "Invalid invoice code format"],
    },
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    laboratoryId: {
      type: Schema.Types.ObjectId,
      ref: "Laboratory",
      required: true,
    },
    sourceType: {
      type: String,
      enum: [...INVOICE_SOURCE_TYPES],
      required: true,
    },
    sourceId: { type: Schema.Types.ObjectId, default: null },
    sourceKey: { type: String, default: null, trim: true },
    activeSourceKey: { type: String, default: null, trim: true },
    items: {
      type: [invoiceItemSchema],
      validate: {
        validator: (items: InvoiceItemSnapshot[]) => items.length > 0,
        message: "Invoice requires at least one item",
      },
    },
    subtotal: { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: [...INVOICE_STATUSES],
      default: "DRAFT",
    },
    notes: { type: String, default: null, trim: true },
    voidReason: { type: String, default: null, trim: true },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    idempotencyKey: { type: String, default: null, trim: true },
  },
  {
    timestamps: true,
  },
);

invoiceSchema.index({ invoiceCode: 1 }, { unique: true });
/** One live invoice per source; nulled when the invoice is VOIDed. */
invoiceSchema.index(
  { activeSourceKey: 1 },
  {
    unique: true,
    partialFilterExpression: { activeSourceKey: { $type: "string" } },
  },
);
/** Idempotent creation replay (same pattern as LabBooking). */
invoiceSchema.index(
  { idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  },
);
invoiceSchema.index({ patientId: 1, createdAt: -1 });
invoiceSchema.index({ laboratoryId: 1, status: 1, createdAt: -1 });
invoiceSchema.index({ createdAt: -1 });

export type InvoiceDocument = HydratedDocument<InvoiceRecord>;

/** Registered through the `getModel` helper (HMR-idempotent). */
export const Invoice = getModel<InvoiceRecord>("Invoice", invoiceSchema);
