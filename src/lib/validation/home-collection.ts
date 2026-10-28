import { z } from "zod";

import {
  COLLECTION_FAILURE_REASON_MAX_LENGTH,
  COLLECTION_NOTE_MAX_LENGTH,
  COLLECTION_STATUS_FILTERS,
  INDIAN_PINCODE_PATTERN,
  MAX_TESTS_PER_COLLECTION,
  ADDRESS_CITY_MAX_LENGTH,
  ADDRESS_INSTRUCTIONS_MAX_LENGTH,
  ADDRESS_LANDMARK_MAX_LENGTH,
  ADDRESS_LINE_MAX_LENGTH,
  ADDRESS_NAME_MAX_LENGTH,
  ADDRESS_STATE_MAX_LENGTH,
} from "@/config/home-collection";
import {
  objectIdSchema,
  paginationSchema,
  PHONE_PATTERN,
} from "./common";

/**
 * Request validation for the home-collection endpoints (STEP 8).
 *
 * Runs once in the browser for instant feedback and again on the server,
 * which is the only place that actually enforces the rules. Server handlers
 * additionally re-verify every relationship, price and capacity claim
 * against the database - these schemas only shape the payload.
 */

/** `YYYY-MM-DD` calendar date (format-level check; timezone rules are server-side). */
export const collectionDateStringSchema = z
  .string("Scheduled date is required.")
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Scheduled date must be in YYYY-MM-DD format.")
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
export const collectionTimeSlotSchema = z
  .string("Time slot is required.")
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Time slot must be in HH:mm format.");

/**
 * Pickup address. GPS coordinates are optional - the platform never invents
 * geolocation and never requires it. Indian PIN codes are required because
 * home collection operates in India.
 */
export const collectionAddressSchema = z.object({
  recipientName: z
    .string("Recipient name is required.")
    .trim()
    .min(2, "Recipient name must be at least 2 characters.")
    .max(
      ADDRESS_NAME_MAX_LENGTH,
      `Recipient name must be ${ADDRESS_NAME_MAX_LENGTH} characters or fewer.`,
    ),
  phone: z
    .string("Contact phone is required.")
    .trim()
    .max(20, "Phone number is too long.")
    .regex(PHONE_PATTERN, "Enter a valid phone number."),
  addressLine1: z
    .string("Address line 1 is required.")
    .trim()
    .min(3, "Address line 1 must be at least 3 characters.")
    .max(
      ADDRESS_LINE_MAX_LENGTH,
      `Address line 1 must be ${ADDRESS_LINE_MAX_LENGTH} characters or fewer.`,
    ),
  addressLine2: z
    .string()
    .trim()
    .max(
      ADDRESS_LINE_MAX_LENGTH,
      `Address line 2 must be ${ADDRESS_LINE_MAX_LENGTH} characters or fewer.`,
    )
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()
    .optional(),
  landmark: z
    .string()
    .trim()
    .max(
      ADDRESS_LANDMARK_MAX_LENGTH,
      `Landmark must be ${ADDRESS_LANDMARK_MAX_LENGTH} characters or fewer.`,
    )
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()
    .optional(),
  city: z
    .string("City is required.")
    .trim()
    .min(2, "City must be at least 2 characters.")
    .max(
      ADDRESS_CITY_MAX_LENGTH,
      `City must be ${ADDRESS_CITY_MAX_LENGTH} characters or fewer.`,
    ),
  state: z
    .string("State is required.")
    .trim()
    .min(2, "State must be at least 2 characters.")
    .max(
      ADDRESS_STATE_MAX_LENGTH,
      `State must be ${ADDRESS_STATE_MAX_LENGTH} characters or fewer.`,
    ),
  pincode: z
    .string("Pincode is required.")
    .trim()
    .regex(
      INDIAN_PINCODE_PATTERN,
      "Enter a valid 6-digit Indian PIN code (e.g. 400001).",
    ),
  /**
   * Pickup coordinates captured through the browser Geolocation API. New
   * requests must carry real coordinates - the platform never invents or
   * defaults them. Existing records created before this rule may still hold
   * null (read-only legacy data).
   */
  latitude: z
    .number("Latitude must be a number.")
    .min(-90, "Latitude must be between -90 and 90.")
    .max(90, "Latitude must be between -90 and 90."),
  longitude: z
    .number("Longitude must be a number.")
    .min(-180, "Longitude must be between -180 and 180.")
    .max(180, "Longitude must be between -180 and 180."),
  instructions: z
    .string()
    .trim()
    .max(
      ADDRESS_INSTRUCTIONS_MAX_LENGTH,
      `Instructions must be ${ADDRESS_INSTRUCTIONS_MAX_LENGTH} characters or fewer.`,
    )
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()
    .optional(),
});

export type CollectionAddressInput = z.infer<typeof collectionAddressSchema>;

/**
 * Create payload.
 *
 * Deliberately carries no prices and no patient identity: prices come from
 * the catalogue on the server, and the patient is resolved from the session
 * (or, for permitted administrative roles, from `patientUserId`).
 */
export const homeCollectionCreateSchema = z.object({
  laboratoryId: objectIdSchema,
  /** Optional link to an eligible STEP 7 lab booking. */
  labBookingId: objectIdSchema.optional(),
  testIds: z
    .array(objectIdSchema, "Select at least one test.")
    .min(1, "Select at least one test.")
    .max(
      MAX_TESTS_PER_COLLECTION,
      `You can request at most ${MAX_TESTS_PER_COLLECTION} tests at once.`,
    )
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "The same test cannot be selected twice.",
    ),
  address: collectionAddressSchema,
  scheduledDate: collectionDateStringSchema,
  timeSlot: collectionTimeSlotSchema,
  collectionInstructions: z
    .string()
    .trim()
    .max(
      COLLECTION_NOTE_MAX_LENGTH,
      `Instructions must be ${COLLECTION_NOTE_MAX_LENGTH} characters or fewer.`,
    )
    .nullable()
    .optional(),
  /** Only honoured for roles allowed to request on behalf of a patient. */
  patientUserId: objectIdSchema.optional(),
  /**
   * Optional client-generated key making retried submissions idempotent.
   * UUID-shaped; the server treats a repeat of the same key as the original
   * request rather than a second collection.
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

export type HomeCollectionCreateInput = z.infer<
  typeof homeCollectionCreateSchema
>;

/** Cancellation payload - the reason is optional but recorded when given. */
export const homeCollectionCancelSchema = z.object({
  reason: z
    .string()
    .trim()
    .max(
      COLLECTION_NOTE_MAX_LENGTH,
      `Reason must be ${COLLECTION_NOTE_MAX_LENGTH} characters or fewer.`,
    )
    .nullable()
    .optional(),
});

export type HomeCollectionCancelInput = z.infer<
  typeof homeCollectionCancelSchema
>;

/** Collector assignment payload. */
export const homeCollectionAssignSchema = z.object({
  collectorId: objectIdSchema,
});

export type HomeCollectionAssignInput = z.infer<
  typeof homeCollectionAssignSchema
>;

/**
 * Rejection payload - the reason is REQUIRED when a lab manager rejects a
 * pending request.
 */
export const homeCollectionRejectSchema = z.object({
  reason: z
    .string("A rejection reason is required.")
    .trim()
    .min(3, "Rejection reason must be at least 3 characters.")
    .max(
      COLLECTION_NOTE_MAX_LENGTH,
      `Reason must be ${COLLECTION_NOTE_MAX_LENGTH} characters or fewer.`,
    ),
});

export type HomeCollectionRejectInput = z.infer<
  typeof homeCollectionRejectSchema
>;

/**
 * OTP verification payload. The collector submits the 6-digit OTP the
 * patient shows them; the server hashes it and compares against the stored
 * hash atomically with the COLLECTED transition.
 */
export const homeCollectionVerifyOtpSchema = z.object({
  otp: z
    .string("OTP is required.")
    .trim()
    .regex(
      /^\d{6}$/,
      "OTP must be a 6-digit number.",
    ),
});

export type HomeCollectionVerifyOtpInput = z.infer<
  typeof homeCollectionVerifyOtpSchema
>;

/**
 * Operational / collector status payload. Only forward transitions listed in
 * the central transition map are accepted; CANCELLED is reachable exclusively
 * through the cancel endpoint. COLLECTED is reachable exclusively through the
 * OTP verification endpoint - it is intentionally absent from this enum so a
 * generic status PATCH can never complete a pickup without OTP proof.
 * Recording a FAILED outcome requires a reason.
 */
export const homeCollectionStatusSchema = z
  .object({
    status: z.enum(
      [
        "CONFIRMED",
        "COLLECTOR_ACCEPTED",
        "COLLECTOR_EN_ROUTE",
        "ARRIVED",
        "FAILED",
      ],
      {
        message:
          "Status must be CONFIRMED, COLLECTOR_ACCEPTED, COLLECTOR_EN_ROUTE, ARRIVED or FAILED. Collection completion requires OTP verification.",
      },
    ),
    failureReason: z
      .string()
      .trim()
      .max(
        COLLECTION_FAILURE_REASON_MAX_LENGTH,
        `Failure reason must be ${COLLECTION_FAILURE_REASON_MAX_LENGTH} characters or fewer.`,
      )
      .nullable()
      .optional(),
  })
  .refine(
    (payload) =>
      payload.status !== "FAILED" ||
      (payload.failureReason !== null &&
        payload.failureReason !== undefined &&
        payload.failureReason.length > 0),
    {
      path: ["failureReason"],
      message: "A failure reason is required when recording a failed pickup.",
    },
  );

export type HomeCollectionStatusInput = z.infer<
  typeof homeCollectionStatusSchema
>;

/** Availability query parameters. */
export const homeCollectionAvailabilityQuerySchema = z.object({
  laboratoryId: objectIdSchema,
  date: collectionDateStringSchema,
});

export type HomeCollectionAvailabilityQuery = z.infer<
  typeof homeCollectionAvailabilityQuerySchema
>;

/** Eligible-bookings query parameters (patient's own bookings for a lab). */
export const homeCollectionEligibleBookingsQuerySchema = z.object({
  laboratoryId: objectIdSchema,
});

export type HomeCollectionEligibleBookingsQuery = z.infer<
  typeof homeCollectionEligibleBookingsQuerySchema
>;

/** Collector directory query parameters. */
export const homeCollectionCollectorsQuerySchema = z.object({
  search: z.string().trim().max(120, "Search term is too long.").optional(),
});

export type HomeCollectionCollectorsQuery = z.infer<
  typeof homeCollectionCollectorsQuerySchema
>;

/** List query parameters: search + filters + pagination. */
export const homeCollectionListQuerySchema = z
  .object({
    search: z
      .string()
      .trim()
      .max(120, "Search term is too long.")
      .regex(
        /^[A-Za-z0-9-]*$/,
        "Search by collection reference using letters, numbers and hyphens.",
      )
      .optional(),
    status: z.enum(COLLECTION_STATUS_FILTERS).default("all"),
    laboratory: objectIdSchema.optional(),
    /** `YYYY-MM-DD` inclusive lower bound on scheduledDate. */
    dateFrom: collectionDateStringSchema.optional(),
    /** `YYYY-MM-DD` inclusive upper bound on scheduledDate. */
    dateTo: collectionDateStringSchema.optional(),
    collector: objectIdSchema.optional(),
    ...paginationSchema.shape,
  })
  .refine(
    (query) =>
      !query.dateFrom ||
      !query.dateTo ||
      query.dateFrom <= query.dateTo,
    {
      path: ["dateTo"],
      message: "The end date must be on or after the start date.",
    },
  );

export type HomeCollectionListQuery = z.infer<
  typeof homeCollectionListQuerySchema
>;

/** Path param validation for `/api/home-collections/[id]`. */
export const homeCollectionIdSchema = z.object({
  id: objectIdSchema,
});
