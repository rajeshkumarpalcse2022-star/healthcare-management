import type {
  InvoiceSourceType,
  InvoiceStatus,
  PaymentKind,
  PaymentMethod,
} from "@/config/billing";
import {
  netPaid,
  outstandingBalance,
} from "@/lib/billing/balance";

/**
 * Invoice DTO mappers (P1-2).
 *
 * Two shapes over the same ledger:
 * - `InvoiceDto` (staff view): adds internal fields - `notes`, `voidReason`,
 *   `createdBy`, payment `note`/`receivedBy` and the timeline.
 * - `InvoiceDto` (patient view): the SAME mapper with `includeInternal=false`,
 *   which leaves the internal keys ABSENT entirely (not undefined) - the
 *   mapper never receives internal notes or actor ids on that path.
 *
 * Money fields (`balance`, `netPaid`) are always recomputed from the payments
 * array passed in - never read from a stored cache. Pure functions over lean
 * shapes: no mongoose imports, client-safe.
 */

export interface InvoiceItemDto {
  labTestId: string | null;
  description: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface InvoicePaymentDto {
  id: string;
  paymentCode: string;
  kind: PaymentKind;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  createdAt: string;
  /** Staff-only memo - key absent for patients. */
  note?: string | null;
  /** Staff-only actor - key absent for patients. */
  receivedBy?: string | null;
}

export interface InvoiceEventDto {
  id: string;
  action: string;
  fromStatus: InvoiceStatus | null;
  toStatus: InvoiceStatus | null;
  actorId: string;
  actorName: string | null;
  metadata: Record<string, string | number | boolean> | null;
  createdAt: string;
}

export interface InvoiceDto {
  id: string;
  invoiceCode: string;
  patientId: string;
  laboratory: { id: string; name: string; code: string } | null;
  patientName: string | null;
  sourceType: InvoiceSourceType;
  sourceId: string | null;
  sourceCode: string | null;
  items: InvoiceItemDto[];
  subtotal: number;
  totalAmount: number;
  /** Net payments minus refunds (recomputed). */
  netPaid: number;
  /** Amount still owed (recomputed, never negative). */
  balance: number;
  status: InvoiceStatus;
  payments: InvoicePaymentDto[];
  createdAt: string;
  updatedAt: string;
  /** Staff-only keys - ABSENT on patient responses. */
  notes?: string | null;
  voidReason?: string | null;
  createdBy?: string | null;
  createdByName?: string | null;
  events?: InvoiceEventDto[];
}

function iso(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function stringId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && "_id" in (value as object)) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
}

function refOrNull(
  value: unknown,
): { id: string; name: string; code: string } | null {
  if (
    value !== null &&
    typeof value === "object" &&
    "_id" in (value as object)
  ) {
    const ref = value as { _id: unknown; name?: unknown; code?: unknown };
    return {
      id: String(ref._id),
      name: typeof ref.name === "string" ? ref.name : "",
      code: typeof ref.code === "string" ? ref.code : "",
    };
  }
  const id = stringId(value);
  return id === null ? null : { id, name: "", code: "" };
}

export interface InvoiceItemShape {
  labTestId?: unknown;
  description: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface InvoiceShape {
  _id: unknown;
  invoiceCode: string;
  patientId: unknown;
  laboratoryId: unknown;
  sourceType: InvoiceSourceType;
  sourceId?: unknown;
  sourceKey?: string | null;
  items: InvoiceItemShape[];
  subtotal: number;
  totalAmount: number;
  status: InvoiceStatus;
  notes?: string | null;
  voidReason?: string | null;
  createdBy?: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface PaymentShape {
  _id: unknown;
  paymentCode: string;
  kind: PaymentKind;
  amount: number;
  method: PaymentMethod;
  reference?: string | null;
  note?: string | null;
  receivedBy?: unknown;
  createdAt: Date | string;
}

export interface PaymentEventShape {
  _id: unknown;
  paymentId?: unknown;
  action: string;
  fromStatus: InvoiceStatus | null;
  toStatus: InvoiceStatus | null;
  actorId?: unknown;
  metadata?: Record<string, string | number | boolean> | null;
  createdAt: Date | string;
}

export function toInvoicePaymentDto(
  payment: PaymentShape,
  includeInternal: boolean,
): InvoicePaymentDto {
  const dto: InvoicePaymentDto = {
    id: String(payment._id),
    paymentCode: payment.paymentCode,
    kind: payment.kind,
    amount: payment.amount,
    method: payment.method,
    reference: payment.reference ?? null,
    createdAt: iso(payment.createdAt),
  };
  if (includeInternal) {
    dto.note = payment.note ?? null;
    dto.receivedBy = stringId(payment.receivedBy);
  }
  return dto;
}

export function toInvoiceEventDto(
  event: PaymentEventShape & { actorId?: unknown },
  actorName: string | null,
): InvoiceEventDto {
  return {
    id: String(event._id),
    action: event.action,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    actorId: stringId(event.actorId) ?? "",
    actorName,
    metadata: event.metadata ?? null,
    createdAt: iso(event.createdAt),
  };
}

/**
 * Maps an invoice + its full payment ledger to the response DTO. `includeInternal`
 * decides whether notes/actor keys exist AT ALL on the object (patient path
 * never sees them).
 */
export function toInvoiceDto(
  invoice: InvoiceShape,
  payments: PaymentShape[],
  includeInternal: boolean,
): InvoiceDto {
  const patient = invoice.patientId;
  const patientName =
    patient !== null &&
    patient !== undefined &&
    typeof patient === "object" &&
    "name" in patient
      ? String((patient as { name: unknown }).name)
      : null;

  const dto: InvoiceDto = {
    id: String(invoice._id),
    invoiceCode: invoice.invoiceCode,
    patientId: stringId(patient) ?? "",
    laboratory: refOrNull(invoice.laboratoryId),
    patientName,
    sourceType: invoice.sourceType,
    sourceId: stringId(invoice.sourceId),
    sourceCode: invoice.sourceKey ?? null,
    items: invoice.items.map((item) => ({
      labTestId: stringId(item.labTestId),
      description: item.description,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
    })),
    subtotal: invoice.subtotal,
    totalAmount: invoice.totalAmount,
    netPaid: netPaid(payments),
    balance: outstandingBalance(invoice.totalAmount, payments),
    status: invoice.status,
    payments: payments.map((payment) =>
      toInvoicePaymentDto(payment, includeInternal),
    ),
    createdAt: iso(invoice.createdAt),
    updatedAt: iso(invoice.updatedAt),
  };

  if (includeInternal) {
    dto.notes = invoice.notes ?? null;
    dto.voidReason = invoice.voidReason ?? null;
    const createdBy = invoice.createdBy;
    dto.createdBy =
      createdBy !== null && createdBy !== undefined && typeof createdBy === "object"
        ? String((createdBy as { _id: unknown })._id)
        : stringId(createdBy);
    dto.createdByName =
      createdBy !== null && typeof createdBy === "object" && "name" in createdBy
        ? String((createdBy as { name: unknown }).name)
        : null;
  }

  return dto;
}
