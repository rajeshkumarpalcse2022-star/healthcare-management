import { z } from "zod";

import { SPECIMEN_TYPES, STATUS_FILTERS, TEST_CATEGORIES } from "@/config/labs";
import {
  codeSchema,
  objectIdSchema,
  optionalText,
  paginationSchema,
  requiredText,
} from "./common";

/**
 * Request validation for the lab test endpoints.
 *
 * Category and specimen are constrained to the central config lists so a typo
 * can never create an orphaned filter value. Relationship checks (department
 * belongs to laboratory, both records active) run server-side after parse.
 */

/** Whole minutes, 0 (immediate) to 30 days. */
const turnaroundTimeSchema = z.coerce
  .number("Enter a valid turnaround time.")
  .int("Turnaround time must be a whole number of minutes.")
  .min(0, "Turnaround time cannot be negative.")
  .max(43_200, "Turnaround time cannot exceed 30 days.");

/** Price in local currency units; must not be negative. */
const priceSchema = z.coerce
  .number("Enter a valid price.")
  .min(0, "Price cannot be negative.")
  .max(1_000_000, "Price is too high.");

/**
 * Sample collection option flags. A test must offer at least one method;
 * the shared `refinements` object applies that rule to both create and
 * update payloads.
 */
const sampleCollectionFields = {
  labVisitEnabled: z
    .boolean("Lab visit must be a boolean.")
    .optional()
    .default(true),
  homeCollectionEnabled: z
    .boolean("Home collection must be a boolean.")
    .optional()
    .default(true),
};

/** Rejects payloads that disable every sample collection method. */
const atLeastOneCollectionMethod = (data: {
  labVisitEnabled?: boolean;
  homeCollectionEnabled?: boolean;
}): boolean => data.labVisitEnabled !== false || data.homeCollectionEnabled !== false;

/** Create payload - lab, department, name, code and pricing are mandatory. */
export const labTestCreateSchema = z
  .object({
    laboratoryId: objectIdSchema,
    departmentId: objectIdSchema,
    name: requiredText(2, 160, "Test name"),
    code: codeSchema,
    category: z.enum(TEST_CATEGORIES),
    specimenType: z.enum(SPECIMEN_TYPES),
    methodology: optionalText(200, "Methodology"),
    turnaroundTimeMinutes: turnaroundTimeSchema,
    description: optionalText(1000, "Description"),
    preparationInstructions: optionalText(1000, "Preparation instructions"),
    price: priceSchema,
    ...sampleCollectionFields,
  })
  .refine(atLeastOneCollectionMethod, {
    message:
      "Enable at least one sample collection method (lab visit or home collection).",
    path: ["labVisitEnabled"],
  });

export type LabTestCreateInput = z.infer<typeof labTestCreateSchema>;

/** Update payload - every field optional; omit a key to leave it unchanged. */
export const labTestUpdateSchema = z
  .object({
    laboratoryId: objectIdSchema.optional(),
    departmentId: objectIdSchema.optional(),
    name: requiredText(2, 160, "Test name").optional(),
    code: codeSchema.optional(),
    category: z.enum(TEST_CATEGORIES).optional(),
    specimenType: z.enum(SPECIMEN_TYPES).optional(),
    methodology: optionalText(200, "Methodology"),
    turnaroundTimeMinutes: turnaroundTimeSchema.optional(),
    description: optionalText(1000, "Description"),
    preparationInstructions: optionalText(1000, "Preparation instructions"),
    price: priceSchema.optional(),
    labVisitEnabled: z.boolean("Lab visit must be a boolean.").optional(),
    homeCollectionEnabled: z
      .boolean("Home collection must be a boolean.")
      .optional(),
  })
  .refine(
    (data) =>
      // Only enforce when the payload itself disables both; a partial update
      // is re-checked against the stored document in the PATCH route.
      data.labVisitEnabled !== false || data.homeCollectionEnabled !== false,
    {
      message:
        "Enable at least one sample collection method (lab visit or home collection).",
      path: ["labVisitEnabled"],
    },
  );

export type LabTestUpdateInput = z.infer<typeof labTestUpdateSchema>;

/** Status toggle payload. */
export const labTestStatusSchema = z.object({
  isActive: z.boolean("isActive must be a boolean."),
});

export type LabTestStatusInput = z.infer<typeof labTestStatusSchema>;

/**
 * List query parameters: search + relationship/category filters +
 * pagination. Query filter names mirror what the UI sends
 * (`laboratory`, `department`, `specimen`).
 */
export const labTestListQuerySchema = z.object({
  search: z.string().trim().max(120, "Search term is too long.").optional(),
  laboratory: objectIdSchema.optional(),
  department: objectIdSchema.optional(),
  category: z.enum(TEST_CATEGORIES).optional(),
  specimen: z.enum(SPECIMEN_TYPES).optional(),
  status: z.enum(STATUS_FILTERS).default("all"),
  ...paginationSchema.shape,
});

export type LabTestListQuery = z.infer<typeof labTestListQuerySchema>;

/** Path param validation for `/api/lab-tests/[id]`. */
export const labTestIdSchema = z.object({
  id: objectIdSchema,
});
