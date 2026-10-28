import { Schema, type HydratedDocument, type Types } from "mongoose";

import { getModel } from "@/lib/db";
import {
  PAYMENT_CODE_PATTERN,
  PAYMENT_KINDS,
  PAYMENT_METHODS,
} from "@/config/billing";

/**
 * Payment - append-only ledger row against an invoice (P1-2).
 *
 * Rows are NEVER updated or deleted by application code: corrections happen
 * by appending a compensating REFUND row, and every status transition on the
 * parent invoice is mirrored into the append-only `PaymentEvent` trail.
 * Amounts are always stored POSITIVE; direction comes from `kind`.
 * The note carries internal staff context and is stripped from patient DTOs.
 */
export interface PaymentRecord {
  paymentCode: string;
  invoiceId: Types.ObjectId;
  laboratoryId: Types.ObjectId;
  kind: (typeof PAYMENT_KINDS)[number];
  amount: number;
  method: (typeof PAYMENT_METHODS)[number];
  reference: string | null;
  /** Internal staff-only memo - excluded from patient responses. */
  note: string | null;
  receivedBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<PaymentRecord>(
  {
    paymentCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      match: [PAYMENT_CODE_PATTERN, "Invalid payment code format"],
    },
    invoiceId: {
      type: Schema.Types.ObjectId,
      ref: "Invoice",
      required: true,
    },
    laboratoryId: {
      type: Schema.Types.ObjectId,
      ref: "Laboratory",
      required: true,
    },
    kind: {
      type: String,
      enum: [...PAYMENT_KINDS],
      required: true,
    },
    amount: { type: Number, required: true, min: 0.01 },
    method: {
      type: String,
      enum: [...PAYMENT_METHODS],
      required: true,
    },
    reference: { type: String, default: null, trim: true },
    note: { type: String, default: null, trim: true },
    receivedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

paymentSchema.index({ paymentCode: 1 }, { unique: true });
paymentSchema.index({ invoiceId: 1, createdAt: 1 });
paymentSchema.index({ createdAt: -1 });

export type PaymentDocument = HydratedDocument<PaymentRecord>;

/** Registered through the `getModel` helper (HMR-idempotent). */
export const Payment = getModel<PaymentRecord>("Payment", paymentSchema);
