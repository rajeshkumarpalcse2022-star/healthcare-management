import { Schema, type HydratedDocument, type Types } from "mongoose";

import { getModel } from "@/lib/db";
import {
  INVOICE_STATUSES,
  PAYMENT_EVENT_ACTIONS,
} from "@/config/billing";

/**
 * PaymentEvent - append-only audit trail for invoice lifecycle (P1-2).
 *
 * Mirrors `LabBookingEvent`/`HomeCollectionEvent`: written exclusively by
 * server routes, never fabricated by clients. One event per creation,
 * status change (issue, void, settle, refund-revert) and per payment/refund
 * recorded, so the full money history of an invoice (who, what, when, from
 * -> to) is reconstructable without mutating any row. `metadata` is limited
 * to operationally safe scalar keys (amount, reason excerpt) - no payment
 * notes, no patient contacts.
 */
export interface PaymentEventRecord {
  invoiceId: Types.ObjectId;
  paymentId: Types.ObjectId | null;
  action: (typeof PAYMENT_EVENT_ACTIONS)[number];
  fromStatus: (typeof INVOICE_STATUSES)[number] | null;
  toStatus: (typeof INVOICE_STATUSES)[number] | null;
  /** User who performed the action (server-derived from the session). */
  actorId: Types.ObjectId;
  metadata: Record<string, string | number | boolean> | null;
  createdAt: Date;
  updatedAt: Date;
}

const paymentEventSchema = new Schema<PaymentEventRecord>(
  {
    invoiceId: {
      type: Schema.Types.ObjectId,
      ref: "Invoice",
      required: true,
    },
    paymentId: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
      default: null,
    },
    action: {
      type: String,
      enum: [...PAYMENT_EVENT_ACTIONS],
      required: true,
    },
    fromStatus: {
      type: String,
      enum: [...INVOICE_STATUSES],
      default: null,
    },
    toStatus: {
      type: String,
      enum: [...INVOICE_STATUSES],
      default: null,
    },
    actorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

/** Timeline lookups for the invoice detail view. */
paymentEventSchema.index({ invoiceId: 1, createdAt: -1 });

export type PaymentEventDocument = HydratedDocument<PaymentEventRecord>;

/** Registered through the `getModel` helper (HMR-idempotent). */
export const PaymentEvent = getModel<PaymentEventRecord>(
  "PaymentEvent",
  paymentEventSchema,
);
