import { z } from "zod";

import {
  COLLECTION_REQUEST_STATUS_FILTERS,
  COLLECTION_REQUEST_TYPE_FILTERS,
} from "@/config/collection-requests";
import { objectIdSchema, paginationSchema } from "./common";

/**
 * Request validation for the central Collection Requests queue endpoint.
 *
 * The queue is read-only: it merges lab-visit bookings and home-collection
 * requests into one list. Every review decision (approve / reject / assign)
 * is still written by the owning module's endpoint, never here.
 */

/** `YYYY-MM-DD` date used by the queue's scheduled-date range filters. */
const queueDateStringSchema = z
  .string("Date must be in YYYY-MM-DD format.")
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const probe = new Date(Date.UTC(year, month - 1, day));
    return (
      probe.getUTCFullYear() === year &&
      probe.getUTCMonth() === month - 1 &&
      probe.getUTCDate() === day
    );
  }, "Enter a valid calendar date.");

/** Queue list query: search + type + status + laboratory + date range + page. */
export const collectionRequestListQuerySchema = z
  .object({
    search: z
      .string()
      .trim()
      .max(120, "Search term is too long.")
      .optional(),
    type: z.enum(COLLECTION_REQUEST_TYPE_FILTERS).default("all"),
    status: z.enum(COLLECTION_REQUEST_STATUS_FILTERS).default("all"),
    laboratory: objectIdSchema.optional(),
    dateFrom: queueDateStringSchema.optional(),
    dateTo: queueDateStringSchema.optional(),
    ...paginationSchema.shape,
  })
  .refine(
    (value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
    { message: "The start date must be on or before the end date." },
  );

export type CollectionRequestListQueryInput = z.infer<
  typeof collectionRequestListQuerySchema
>;
