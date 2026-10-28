import { z } from "zod";

import {
  INVENTORY_CATEGORIES,
  INVENTORY_UNITS,
  STOCK_TX_TYPES,
} from "@/config/inventory";
import { objectIdSchema, paginationSchema } from "./common";

/** Shared enum helpers - single source for API + error messages. */
export const inventoryCategorySchema = z.enum(INVENTORY_CATEGORIES);
export const inventoryUnitSchema = z.enum(INVENTORY_UNITS);
export const stockTxTypeSchema = z.enum(STOCK_TX_TYPES);

/** Dates arrive as `YYYY-MM-DD` from date inputs; Date objects in-process. */
const dateishSchema = z.union([
  z.iso.date(),
  z.iso.datetime(),
  z.date(),
  z.null(),
]);

const nameField = z
  .string()
  .trim()
  .min(2, "Item name must be at least 2 characters.")
  .max(120, "Item name must be 120 characters or fewer.");

/**
 * Item CREATE - no `quantity` key at all: stock only moves through stock
 * transactions (approved P1-3 rule). New items start at zero; the UI records
 * the opening receipt as an IN transaction so history stays complete.
 */
export const inventoryItemCreateSchema = z.object({
  name: nameField,
  category: inventoryCategorySchema,
  unit: inventoryUnitSchema,
  reorderLevel: z.number().int().min(0).max(1_000_000).default(0),
  expiryDate: dateishSchema.optional(),
  laboratoryId: z.string().trim().min(1).max(64),
});

/** Item UPDATE - metadata only; `quantity` is not an accepted key at all. */
export const inventoryItemUpdateSchema = z
  .object({
    name: nameField.optional(),
    category: inventoryCategorySchema.optional(),
    unit: inventoryUnitSchema.optional(),
    reorderLevel: z.number().int().min(0).max(1_000_000).optional(),
    expiryDate: dateishSchema.optional(),
  })
  .refine(
    (value) =>
      Object.values(value).some((entry) => entry !== undefined),
    { message: "Provide at least one field to update." },
  );

/**
 * Stock transaction create. IN forces a positive delta, OUT forces a
 * negative one, ADJUST accepts either (never zero) - e.g. cycle-count
 * corrections. Equipment may never move OUT (enforced route-side).
 */
export const stockTxCreateSchema = z
  .object({
    type: stockTxTypeSchema,
    delta: z
      .number()
      .int("Quantity changes are whole units in the smallest unit type.")
      .min(-1_000_000)
      .max(1_000_000),
    itemId: objectIdSchema,
  })
  .superRefine((value, ctx) => {
    if (value.delta === 0) {
      ctx.addIssue({
        code: "custom",
        message: "Quantity change must not be zero.",
        path: ["delta"],
      });
      return;
    }
    if (value.type === "IN" && value.delta < 0) {
      ctx.addIssue({
        code: "custom",
        message: "Stock IN must increase quantity (use a positive amount).",
        path: ["delta"],
      });
      return;
    }
    if (value.type === "OUT" && value.delta > 0) {
      ctx.addIssue({
        code: "custom",
        message: "Stock OUT must decrease quantity (use a negative amount).",
        path: ["delta"],
      });
    }
  });

export type StockTxCreateInput = z.infer<typeof stockTxCreateSchema>;

export const inventoryListQuerySchema = paginationSchema.extend({
  search: z
    .string()
    .trim()
    .max(120, "Search term is too long.")
    .optional(),
  category: inventoryCategorySchema.optional(),
  lowStock: z.enum(["true"]).optional(),
  expiring: z.enum(["true"]).optional(),
  laboratoryId: objectIdSchema.optional(),
});

export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>;

/** Path param validation for `/api/inventory/[id]`. */
export const inventoryIdSchema = z.object({
  id: objectIdSchema,
});
