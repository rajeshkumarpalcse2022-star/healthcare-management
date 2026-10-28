import { z } from "zod";

import {
  INVOICE_ITEM_DESCRIPTION_MAX,
  INVOICE_NOTE_MAX_LENGTH,
  INVOICE_SOURCE_TYPES,
  INVOICE_STATUSES,
  MAX_INVOICE_ITEMS,
  MAX_ITEM_QUANTITY,
  MAX_ITEM_UNIT_PRICE,
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  PAYMENT_NOTE_MAX_LENGTH,
  PAYMENT_REFERENCE_MAX_LENGTH,
} from "@/config/billing";
import { objectIdSchema, paginationSchema } from "./common";

/**
 * Request validation for the billing & payment endpoints (P1-2).
 *
 * Runs in the browser for form UX and again on the server, which is the only
 * place that enforces the rules. Every monetary field additionally passes
 * `money()`-style rounding checks server-side; these schemas only shape the
 * payload (finite, bounded, well-typed numbers).
 */

/** One invoice line: bounded price/quantity, non-negative finite money. */
export const invoiceItemSchema = z.object({
  labTestId: objectIdSchema.nullable().optional(),
  description: z
    .string("Item description is required.")
    .trim()
    .min(1, "Item description is required.")
    .max(
      INVOICE_ITEM_DESCRIPTION_MAX,
      `Description must be ${INVOICE_ITEM_DESCRIPTION_MAX} characters or fewer.`,
    ),
  unitPrice: z
    .number("Unit price is required.")
    .finite("Unit price must be a valid amount.")
    .min(0, "Unit price cannot be negative.")
    .max(
      MAX_ITEM_UNIT_PRICE,
      `Unit price must be ${MAX_ITEM_UNIT_PRICE} or less.`,
    ),
  quantity: z
    .number("Quantity is required.")
    .int("Quantity must be a whole number.")
    .min(1, "Quantity must be at least 1.")
    .max(MAX_ITEM_QUANTITY, `Quantity must be ${MAX_ITEM_QUANTITY} or fewer.`),
});

export type InvoiceItemInput = z.infer<typeof invoiceItemSchema>;

/** Items array shared by manual creation and DRAFT edits. */
const invoiceItemsField = z
  .array(invoiceItemSchema, "Add at least one item.")
  .min(1, "Add at least one item.")
  .max(
    MAX_INVOICE_ITEMS,
    `An invoice can have at most ${MAX_INVOICE_ITEMS} items.`,
  );

/**
 * Create payload. Two shapes via discriminated union:
 * - BOOKING / HOME_COLLECTION: invoice is built from the source's immutable
 *   snapshots (items and prices are never client-supplied);
 * - MANUAL: staff supplies patient, laboratory and item lines directly.
 */
const idempotencyKeyField = z
  .string()
  .trim()
  .min(8, "Idempotency key is too short.")
  .max(100, "Idempotency key is too long.")
  .regex(
    /^[A-Za-z0-9_-]+$/,
    "Idempotency key may only contain letters, numbers, dashes and underscores.",
  );

const invoiceNotesField = z
  .string()
  .trim()
  .max(
    INVOICE_NOTE_MAX_LENGTH,
    `Notes must be ${INVOICE_NOTE_MAX_LENGTH} characters or fewer.`,
  )
  .nullable()
  .optional();

export const invoiceCreateSchema = z.discriminatedUnion("sourceType", [
  z.object({
    sourceType: z.literal("BOOKING"),
    sourceId: objectIdSchema,
    notes: invoiceNotesField,
    idempotencyKey: idempotencyKeyField.optional(),
  }),
  z.object({
    sourceType: z.literal("HOME_COLLECTION"),
    sourceId: objectIdSchema,
    notes: invoiceNotesField,
    idempotencyKey: idempotencyKeyField.optional(),
  }),
  z.object({
    sourceType: z.literal("MANUAL"),
    patientId: objectIdSchema,
    laboratoryId: objectIdSchema,
    items: invoiceItemsField,
    notes: invoiceNotesField,
    idempotencyKey: idempotencyKeyField.optional(),
  }),
]);

export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>;

/**
 * Update payload: DRAFT field edits (items/notes) and the two explicit
 * client transitions (issue, void). VOID requires a reason - enforced here
 * and re-checked server-side against the transition map.
 */
export const invoiceUpdateSchema = z
  .object({
    items: invoiceItemsField.optional(),
    notes: z
      .string()
      .trim()
      .max(
        INVOICE_NOTE_MAX_LENGTH,
        `Notes must be ${INVOICE_NOTE_MAX_LENGTH} characters or fewer.`,
      )
      .nullable()
      .optional(),
    status: z
      .enum(["ISSUED", "VOID"], {
        message: "Status must be ISSUED or VOID.",
      })
      .optional(),
    voidReason: z
      .string()
      .trim()
      .min(3, "A void reason of at least 3 characters is required.")
      .max(
        INVOICE_NOTE_MAX_LENGTH,
        `Reason must be ${INVOICE_NOTE_MAX_LENGTH} characters or fewer.`,
      )
      .optional(),
  })
  .refine(
    (value) => value.status !== "VOID" || value.voidReason !== undefined,
    { message: "A void reason is required.", path: ["voidReason"] },
  );

export type InvoiceUpdateInput = z.infer<typeof invoiceUpdateSchema>;

/** Payment/refund recording payload. Amounts always positive; kind carries direction. */
export const paymentCreateSchema = z.object({
  kind: z.enum(PAYMENT_KINDS, {
    message: "Kind must be PAYMENT or REFUND.",
  }),
  amount: z
    .number("Amount is required.")
    .finite("Amount must be a valid number.")
    .positive("Amount must be greater than zero.")
    .max(
      MAX_ITEM_UNIT_PRICE * MAX_ITEM_QUANTITY,
      "Amount is too large.",
    ),
  method: z.enum(PAYMENT_METHODS, {
    message: "Select a valid payment method.",
  }),
  reference: z
    .string()
    .trim()
    .max(
      PAYMENT_REFERENCE_MAX_LENGTH,
      `Reference must be ${PAYMENT_REFERENCE_MAX_LENGTH} characters or fewer.`,
    )
    .nullable()
    .optional(),
  note: z
    .string()
    .trim()
    .max(
      PAYMENT_NOTE_MAX_LENGTH,
      `Note must be ${PAYMENT_NOTE_MAX_LENGTH} characters or fewer.`,
    )
    .nullable()
    .optional(),
});

export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;

/** Invoice list query: code search + status/source/patient filters. */
export const invoiceListQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .max(64, "Search term is too long.")
    .regex(
      /^[A-Za-z0-9-]*$/,
      "Search by invoice reference using letters, numbers and hyphens.",
    )
    .optional(),
  status: z.enum(["all", ...INVOICE_STATUSES]).default("all"),
  sourceType: z.enum(INVOICE_SOURCE_TYPES).optional(),
  patient: objectIdSchema.optional(),
  laboratory: objectIdSchema.optional(),
  /** Restrict to invoices generated from one source (patient booking card). */
  sourceId: objectIdSchema.optional(),
  ...paginationSchema.shape,
});

export type InvoiceListQuery = z.infer<typeof invoiceListQuerySchema>;

/** Path param validation for `/api/invoices/[id]`. */
export const invoiceIdSchema = z.object({
  id: objectIdSchema,
});
