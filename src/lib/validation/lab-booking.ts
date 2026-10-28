import { z } from "zod";

import {
  BOOKING_NOTE_MAX_LENGTH,
  BOOKING_STATUS_FILTERS,
  MAX_TESTS_PER_BOOKING,
} from "@/config/lab-bookings";
import {
  objectIdSchema,
  optionalEmailSchema,
  optionalPhoneSchema,
  paginationSchema,
} from "./common";

/**
 * Request validation for the online lab-booking endpoints.
 *
 * Runs once in the browser for instant feedback and again on the server,
 * which is the only place that actually enforces the rules. Server handlers
 * additionally re-verify every relationship, price and capacity claim
 * against the database - these schemas only shape the payload.
 */

/** `YYYY-MM-DD` calendar date (format-level check; timezone rules are server-side). */
export const bookingDateStringSchema = z
  .string("Booking date is required.")
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Booking date must be in YYYY-MM-DD format.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const probe = new Date(Date.UTC(year, month - 1, day));
    return (
      probe.getUTCFullYear() === year &&
      probe.getUTCMonth() === month - 1 &&
      probe.getUTCDate() === day
    );
  }, "Enter a valid calendar date.");

/** `HH:mm` slot start. */
export const timeSlotStringSchema = z
  .string("Time slot is required.")
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time slot must be in HH:mm format.");

/** Optional contact confirmation used for the booking snapshot. */
export const bookingContactSchema = z.object({
  phone: optionalPhoneSchema,
  email: optionalEmailSchema,
});

export type BookingContactInput = z.infer<typeof bookingContactSchema>;

/**
 * Create payload.
 *
 * Deliberately carries no prices and no patient identity: prices come from
 * the catalogue on the server, and the patient is resolved from the session
 * (or, for permitted administrative roles, from `patientUserId`).
 */
export const labBookingCreateSchema = z.object({
  laboratoryId: objectIdSchema,
  testIds: z
    .array(objectIdSchema, "Select at least one test.")
    .min(1, "Select at least one test.")
    .max(
      MAX_TESTS_PER_BOOKING,
      `You can book at most ${MAX_TESTS_PER_BOOKING} tests at once.`,
    )
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "The same test cannot be selected twice.",
    ),
  bookingDate: bookingDateStringSchema,
  timeSlot: timeSlotStringSchema,
  notes: z
    .string()
    .trim()
    .max(
      BOOKING_NOTE_MAX_LENGTH,
      `Notes must be ${BOOKING_NOTE_MAX_LENGTH} characters or fewer.`,
    )
    .nullable()
    .optional(),
  contact: bookingContactSchema.optional(),
  /** Only honoured for roles allowed to book on behalf of a patient. */
  patientUserId: objectIdSchema.optional(),
  /**
   * Optional client-generated key making retried submissions idempotent.
   * UUID-shaped; the server treats a repeat of the same key as the original
   * request rather than a second booking.
   */
  idempotencyKey: z
    .string()
    .trim()
    .min(8, "Idempotency key is too short.")
    .max(100, "Idempotency key is too long.")
    .regex(
      /^[A-Za-z0-9_-]+$/,
      "Idempotency key may only contain letters, numbers, dashes and underscores.",
    )
    .optional(),
});

export type LabBookingCreateInput = z.infer<typeof labBookingCreateSchema>;

/** Cancellation payload - the reason is optional but recorded when given. */
export const labBookingCancelSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(
      BOOKING_NOTE_MAX_LENGTH,
      `Reason must be ${BOOKING_NOTE_MAX_LENGTH} characters or fewer.`,
    )
    .nullable()
    .optional(),
});

export type LabBookingCancelInput = z.infer<typeof labBookingCancelSchema>;

/**
 * Rejection payload - the reason is REQUIRED when a lab manager rejects a
 * pending lab-visit request from the central review queue.
 */
export const labBookingRejectSchema = z.object({
  reason: z
    .string("A rejection reason is required.")
    .trim()
    .min(3, "Rejection reason must be at least 3 characters.")
    .max(
      BOOKING_NOTE_MAX_LENGTH,
      `Reason must be ${BOOKING_NOTE_MAX_LENGTH} characters or fewer.`,
    ),
});

export type LabBookingRejectInput = z.infer<typeof labBookingRejectSchema>;

/**
 * Operational status payload. Only forward transitions are accepted;
 * CANCELLED is reachable exclusively through the dedicated cancel endpoint.
 */
export const labBookingStatusSchema = z.object({
  status: z.enum(["CONFIRMED", "COMPLETED"], {
    message: "Status must be CONFIRMED or COMPLETED.",
  }),
});

export type LabBookingStatusInput = z.infer<typeof labBookingStatusSchema>;

/** Availability query parameters. */
export const labBookingAvailabilityQuerySchema = z.object({
  laboratoryId: objectIdSchema,
  date: bookingDateStringSchema,
});

export type LabBookingAvailabilityQuery = z.infer<
  typeof labBookingAvailabilityQuerySchema
>;

/** Catalogue tests query parameters. */
export const labBookingTestsQuerySchema = z.object({
  laboratoryId: objectIdSchema,
  department: objectIdSchema.optional(),
  category: z.string().trim().max(80).optional(),
  search: z.string().trim().max(120, "Search term is too long.").optional(),
});

export type LabBookingTestsQuery = z.infer<typeof labBookingTestsQuerySchema>;

/** List query parameters: search + status + laboratory + pagination.
 *
 * `status=REVIEWED` is a list-filter value (not a persisted status): it
 * selects every booking except the ones still awaiting lab-manager review,
 * which is what the Online Booking management section shows by default.
 */
export const labBookingListQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .max(120, "Search term is too long.")
    .regex(
      /^[A-Za-z0-9-]*$/,
      "Search by booking reference using letters, numbers and hyphens.",
    )
    .optional(),
  status: z.enum(BOOKING_STATUS_FILTERS).default("all"),
  laboratory: objectIdSchema.optional(),
  ...paginationSchema.shape,
});

export type LabBookingListQuery = z.infer<typeof labBookingListQuerySchema>;

/** Path param validation for `/api/lab-bookings/[id]`. */
export const labBookingIdSchema = z.object({
  id: objectIdSchema,
});
