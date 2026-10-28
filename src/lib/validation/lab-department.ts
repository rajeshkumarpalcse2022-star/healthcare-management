import { z } from "zod";

import { STATUS_FILTERS } from "@/config/labs";
import {
  codeSchema,
  objectIdSchema,
  optionalText,
  paginationSchema,
  requiredText,
} from "./common";

/**
 * Request validation for the lab department endpoints.
 *
 * Relationship checks (laboratory exists / is active, code uniqueness within
 * the laboratory) run on the server after this parse - Zod only proves the
 * payload's shape.
 */

/** Create payload - laboratory, name and code are mandatory. */
export const departmentCreateSchema = z.object({
  laboratoryId: objectIdSchema,
  name: requiredText(2, 100, "Department name"),
  code: codeSchema,
  description: optionalText(400, "Description"),
});

export type DepartmentCreateInput = z.infer<typeof departmentCreateSchema>;

/** Update payload - every field optional; omit a key to leave it unchanged. */
export const departmentUpdateSchema = z.object({
  laboratoryId: objectIdSchema.optional(),
  name: requiredText(2, 100, "Department name").optional(),
  code: codeSchema.optional(),
  description: optionalText(400, "Description"),
});

export type DepartmentUpdateInput = z.infer<typeof departmentUpdateSchema>;

/** Status toggle payload. */
export const departmentStatusSchema = z.object({
  isActive: z.boolean("isActive must be a boolean."),
});

export type DepartmentStatusInput = z.infer<typeof departmentStatusSchema>;

/** List query parameters: search + status + pagination. */
export const departmentListQuerySchema = z.object({
  search: z.string().trim().max(120, "Search term is too long.").optional(),
  status: z.enum(STATUS_FILTERS).default("all"),
  ...paginationSchema.shape,
});

export type DepartmentListQuery = z.infer<typeof departmentListQuerySchema>;

/** Path param validation for `/api/lab-departments/[id]`. */
export const departmentIdSchema = z.object({
  id: objectIdSchema,
});
