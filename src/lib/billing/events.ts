import "server-only";

import type { ClientSession } from "mongoose";

import type {
  InvoiceStatus,
  PaymentEventAction,
} from "@/config/billing";
import { PaymentEvent } from "@/models/PaymentEvent";

/**
 * Appends one audit event for an invoice lifecycle action (P1-2).
 *
 * Mirrors `appendBookingEvent`: called only from the API routes that perform
 * the action, actor derived from the verified session - clients can never
 * fabricate actors or timestamps. Failures are logged, not thrown: losing an
 * audit row must not turn a successful money action into a 5xx (the invoice
 * and payment documents already carry the authoritative state).
 *
 * `session` participates in the caller's transaction when one is available,
 * so the event row commits together with the money writes it describes.
 */
export async function appendPaymentEvent(input: {
  invoiceId: string;
  paymentId?: string | null;
  action: PaymentEventAction;
  fromStatus: InvoiceStatus | null;
  toStatus: InvoiceStatus | null;
  actorId: string;
  metadata?: Record<string, string | number | boolean> | null;
  session?: ClientSession | null;
}): Promise<void> {
  const record = {
    invoiceId: input.invoiceId,
    paymentId: input.paymentId ?? null,
    action: input.action,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    actorId: input.actorId,
    metadata:
      input.metadata && Object.keys(input.metadata).length > 0
        ? input.metadata
        : null,
  };
  try {
    if (input.session) {
      await PaymentEvent.create([record], { session: input.session });
    } else {
      await PaymentEvent.create(record);
    }
  } catch (error) {
    console.error(
      "[billing] audit event write failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}
