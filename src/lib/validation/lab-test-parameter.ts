import { z } from "zod";

import { PARAMETER_DATA_TYPES } from "@/config/labs";
import { codeSchema, objectIdSchema, optionalText, requiredText } from "./common";

/**
 * Request validation for the lab test parameter endpoints.
 *
 * Numeric fields arrive from form inputs as either real numbers or blank
 * strings, so `clearableNumber` normalises before validating: blank → `null`
 * (clear), omitted → `undefined` (leave unchanged), numeric string → number.
 */

function clearableNumber() {
  return z.preprocess((value) => {
    if (value === "" || value === undefined) {
      return value === "" ? null : undefined;
    }
    if (typeof value === "string" && value.trim() !== "") {
      return Number(value);
    }
    return value;
  }, z.number().finite("Enter a valid number.").nullable().optional());
}

/** Structured reference range: numeric bounds and/or free-text guidance. */
const referenceRangeSchema = z
  .object({
    low: clearableNumber(),
    high: clearableNumber(),
    text: z
      .string()
      .trim()
      .max(160, "Reference text must be 160 characters or fewer.")
      .nullable()
      .optional(),
  })
  .refine(
    (range) =>
      typeof range.low !== "number" ||
      typeof range.high !== "number" ||
      range.low <= range.high,
    "Low reference value cannot exceed the high value.",
  );

/** Position within the parameter list; the server renumbers on conflict. */
const displayOrderSchema = z.coerce
  .number("Enter a valid display order.")
  .int("Display order must be a whole number.")
  .min(1, "Display order must be at least 1.")
  .max(999, "Display order must be 999 or fewer.");

/** Create payload - test, name, code and data type are mandatory. */
export const parameterCreateSchema = z.object({
  labTestId: objectIdSchema,
  name: requiredText(2, 120, "Parameter name"),
  code: codeSchema,
  dataType: z.enum(PARAMETER_DATA_TYPES),
  unit: optionalText(40, "Unit"),
  referenceRange: referenceRangeSchema.optional(),
  criticalLow: clearableNumber(),
  criticalHigh: clearableNumber(),
  displayOrder: displayOrderSchema.optional(),
  isRequired: z.boolean().optional(),
});

export type ParameterCreateInput = z.infer<typeof parameterCreateSchema>;

/** Update payload - every field optional; omit a key to leave it unchanged. */
export const parameterUpdateSchema = z.object({
  name: requiredText(2, 120, "Parameter name").optional(),
  code: codeSchema.optional(),
  dataType: z.enum(PARAMETER_DATA_TYPES).optional(),
  unit: optionalText(40, "Unit"),
  referenceRange: referenceRangeSchema.optional(),
  criticalLow: clearableNumber(),
  criticalHigh: clearableNumber(),
  displayOrder: displayOrderSchema.optional(),
  isRequired: z.boolean().optional(),
});

export type ParameterUpdateInput = z.infer<typeof parameterUpdateSchema>;

/** Path param validation for `/api/lab-test-parameters/[id]`. */
export const parameterIdSchema = z.object({
  id: objectIdSchema,
});
