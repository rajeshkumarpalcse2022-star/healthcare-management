import { z } from "zod";

import { STATUS_FILTERS } from "@/config/labs";
import {
  MAX_ADVANCE_DAYS_MAX,
  MAX_ADVANCE_DAYS_MIN,
  SLOT_CAPACITY_MAX,
  SLOT_CAPACITY_MIN,
  SLOT_DURATION_MINUTES_MAX,
  SLOT_DURATION_MINUTES_MIN,
} from "@/config/lab-bookings";
import { isValidTimeZone } from "@/lib/utils/booking-time";
import {
  codeSchema,
  objectIdSchema,
  optionalEmailSchema,
  optionalPhoneSchema,
  optionalPincodeSchema,
  optionalText,
  paginationSchema,
  requiredText,
} from "./common";

/**
 * Request validation for the laboratory endpoints.
 *
 * Used twice per write: once in the browser for instant feedback and again on
 * the server, which is the only place that actually enforces the rules.
 */

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Online-booking configuration accepted on laboratory create / update.
 *
 * `null` clears the configuration (laboratory stops accepting bookings);
 * omitted leaves it unchanged; an object configures or replaces it.
 */
export const laboratoryBookingConfigSchema = z
  .object({
    timezone: z
      .string("Timezone is required.")
      .trim()
      .max(64, "Timezone is too long.")
      .refine(
        (value) => isValidTimeZone(value),
        "Enter a valid IANA timezone (e.g. Asia/Kolkata).",
      ),
    operatingDays: z
      .array(
        z
          .number()
          .int("Operating days must be whole numbers.")
          .min(0, "Weekday index must be 0 (Sunday) or later.")
          .max(6, "Weekday index must be 6 (Saturday) or earlier."),
      )
      .min(1, "Select at least one operating day.")
      .max(7, "Select at most seven operating days.")
      .refine(
        (days) => new Set(days).size === days.length,
        "Operating days must not contain duplicates.",
      ),
    openingTime: z
      .string("Opening time is required.")
      .trim()
      .regex(TIME_PATTERN, "Opening time must be in HH:mm format."),
    closingTime: z
      .string("Closing time is required.")
      .trim()
      .regex(TIME_PATTERN, "Closing time must be in HH:mm format."),
    slotDurationMinutes: z
      .number("Slot duration is required.")
      .int("Slot duration must be a whole number of minutes.")
      .min(
        SLOT_DURATION_MINUTES_MIN,
        `Slot duration must be at least ${SLOT_DURATION_MINUTES_MIN} minutes.`,
      )
      .max(
        SLOT_DURATION_MINUTES_MAX,
        `Slot duration must be at most ${SLOT_DURATION_MINUTES_MAX} minutes.`,
      ),
    slotCapacity: z
      .number("Slot capacity is required.")
      .int("Slot capacity must be a whole number.")
      .min(SLOT_CAPACITY_MIN, `Slot capacity must be at least ${SLOT_CAPACITY_MIN}.`)
      .max(SLOT_CAPACITY_MAX, `Slot capacity must be at most ${SLOT_CAPACITY_MAX}.`),
    maxAdvanceDays: z
      .number("Advance booking window is required.")
      .int("Advance booking window must be a whole number of days.")
      .min(
        MAX_ADVANCE_DAYS_MIN,
        `Advance window must be at least ${MAX_ADVANCE_DAYS_MIN} day(s).`,
      )
      .max(
        MAX_ADVANCE_DAYS_MAX,
        `Advance window must be at most ${MAX_ADVANCE_DAYS_MAX} days.`,
      ),
  })
  .refine(
    (config) => config.closingTime > config.openingTime,
    { path: ["closingTime"], message: "Closing time must be later than the opening time." },
  );

export type LaboratoryBookingConfigInput = z.infer<
  typeof laboratoryBookingConfigSchema
>;

/**
 * Home sample-collection configuration (STEP 8). Same field shape as the
 * booking configuration but validated and stored separately so collection
 * capacity can differ from in-lab booking capacity.
 */
export const laboratoryHomeCollectionConfigSchema =
  laboratoryBookingConfigSchema;

export type LaboratoryHomeCollectionConfigInput = z.infer<
  typeof laboratoryHomeCollectionConfigSchema
>;

/** Create payload - name and code are mandatory; contact details optional. */
export const laboratoryCreateSchema = z.object({
  name: requiredText(2, 120, "Laboratory name"),
  code: codeSchema,
  phone: optionalPhoneSchema,
  email: optionalEmailSchema,
  address: optionalText(240, "Address"),
  city: optionalText(80, "City"),
  state: optionalText(80, "State"),
  pincode: optionalPincodeSchema,
  registrationNumber: optionalText(64, "Registration number"),
  accreditation: optionalText(160, "Accreditation"),
  bookingConfig: laboratoryBookingConfigSchema.nullish(),
  homeCollectionConfig: laboratoryHomeCollectionConfigSchema.nullish(),
});

export type LaboratoryCreateInput = z.infer<typeof laboratoryCreateSchema>;

/** Update payload - every field optional; omit a key to leave it unchanged. */
export const laboratoryUpdateSchema = z.object({
  name: requiredText(2, 120, "Laboratory name").optional(),
  code: codeSchema.optional(),
  phone: optionalPhoneSchema,
  email: optionalEmailSchema,
  address: optionalText(240, "Address"),
  city: optionalText(80, "City"),
  state: optionalText(80, "State"),
  pincode: optionalPincodeSchema,
  registrationNumber: optionalText(64, "Registration number"),
  accreditation: optionalText(160, "Accreditation"),
  bookingConfig: laboratoryBookingConfigSchema.nullish(),
  homeCollectionConfig: laboratoryHomeCollectionConfigSchema.nullish(),
});

export type LaboratoryUpdateInput = z.infer<typeof laboratoryUpdateSchema>;

/** Status toggle payload. */
export const laboratoryStatusSchema = z.object({
  isActive: z.boolean("isActive must be a boolean."),
});

export type LaboratoryStatusInput = z.infer<typeof laboratoryStatusSchema>;

/** List query parameters: search + status + pagination. */
export const laboratoryListQuerySchema = z.object({
  search: z.string().trim().max(120, "Search term is too long.").optional(),
  status: z.enum(STATUS_FILTERS).default("all"),
  ...paginationSchema.shape,
});

export type LaboratoryListQuery = z.infer<typeof laboratoryListQuerySchema>;

/** Path param validation for `/api/laboratories/[id]`. */
export const laboratoryIdSchema = z.object({
  id: objectIdSchema,
});
