/**
 * Billing & Payment configuration (P1-2). Internal recording system only:
 * no gateway, no tax/legal modelling, currency implicit (INR context).
 *
 * Lifecycle: DRAFT -> ISSUED -> PAID, with VOID reachable from DRAFT and
 * from ISSUED only while no payment exists (refunds first). PAID -> ISSUED
 * happens ONLY automatically when a full refund restores the entire balance
 * - it is never a client-requested transition.
 */
export const INVOICE_STATUSES = ["DRAFT", "ISSUED", "PAID", "VOID"] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  PAID: "Paid",
  VOID: "Void",
};

/**
 * Explicit client-requestable transitions (issue / void). Automatic
 * settlement (ISSUED -> PAID) and refund-driven reversion (PAID -> ISSUED)
 * are applied server-side and deliberately absent from this map.
 */
export const INVOICE_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ["ISSUED", "VOID"],
  ISSUED: ["VOID"],
  PAID: [],
  VOID: [],
};

export const INVOICE_SOURCE_TYPES = [
  "BOOKING",
  "HOME_COLLECTION",
  "MANUAL",
] as const;

export type InvoiceSourceType = (typeof INVOICE_SOURCE_TYPES)[number];

/**
 * Source statuses that may be invoiced from their immutable snapshots.
 * Services in progress or completed, plus cancellations (historical
 * invoicing); never-rejected PENDING/FAILED work is deliberately excluded.
 */
export const INVOICEABLE_BOOKING_STATUSES = [
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
] as const;

export const INVOICEABLE_COLLECTION_STATUSES = [
  "CONFIRMED",
  "ASSIGNED",
  "COLLECTOR_ACCEPTED",
  "COLLECTOR_EN_ROUTE",
  "ARRIVED",
  "COLLECTED",
  "CANCELLED",
] as const;

export const PAYMENT_KINDS = ["PAYMENT", "REFUND"] as const;

export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  PAYMENT: "Payment",
  REFUND: "Refund",
};

export const PAYMENT_METHODS = [
  "CASH",
  "CARD",
  "UPI",
  "BANK_TRANSFER",
  "OTHER",
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Cash",
  CARD: "Card",
  UPI: "UPI",
  BANK_TRANSFER: "Bank transfer",
  OTHER: "Other",
};

export const PAYMENT_EVENT_ACTIONS = [
  "INVOICE_CREATED",
  "INVOICE_ISSUED",
  "INVOICE_VOIDED",
  "PAYMENT_RECORDED",
  "REFUND_RECORDED",
  "INVOICE_SETTLED",
  "INVOICE_REVERTED",
  "INVOICE_UPDATED",
] as const;

export type PaymentEventAction = (typeof PAYMENT_EVENT_ACTIONS)[number];

export const INVOICE_CODE_PATTERN = /^INV-\d{4}-\d{6}$/;
export const PAYMENT_CODE_PATTERN = /^PAY-\d{4}-\d{6}$/;

export function formatInvoiceCode(year: number, sequence: number): string {
  return `INV-${year}-${String(sequence).padStart(6, "0")}`;
}

export function formatPaymentCode(year: number, sequence: number): string {
  return `PAY-${year}-${String(sequence).padStart(6, "0")}`;
}

export const MAX_INVOICE_ITEMS = 20;
export const INVOICE_NOTE_MAX_LENGTH = 500;
export const PAYMENT_NOTE_MAX_LENGTH = 300;
export const PAYMENT_REFERENCE_MAX_LENGTH = 100;
export const INVOICE_ITEM_DESCRIPTION_MAX = 160;
export const MAX_ITEM_UNIT_PRICE = 1_000_000;
export const MAX_ITEM_QUANTITY = 999;
