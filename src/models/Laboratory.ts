import { Schema, type HydratedDocument } from "mongoose";

import { getModel } from "@/lib/db";
import {
  DEFAULT_MAX_ADVANCE_DAYS,
  DEFAULT_OPERATING_DAYS,
  DEFAULT_SLOT_CAPACITY,
  DEFAULT_SLOT_DURATION_MINUTES,
  DEFAULT_BOOKING_TIMEZONE,
  DEFAULT_CLOSING_TIME,
  DEFAULT_OPENING_TIME,
  MAX_ADVANCE_DAYS_MAX,
  MAX_ADVANCE_DAYS_MIN,
  SLOT_CAPACITY_MAX,
  SLOT_CAPACITY_MIN,
  SLOT_DURATION_MINUTES_MAX,
  SLOT_DURATION_MINUTES_MIN,
} from "@/config/lab-bookings";
import {
  DEFAULT_COLLECTION_MAX_ADVANCE_DAYS,
  DEFAULT_COLLECTION_OPERATING_DAYS,
  DEFAULT_COLLECTION_SLOT_CAPACITY,
  DEFAULT_COLLECTION_SLOT_DURATION_MINUTES,
  DEFAULT_COLLECTION_TIMEZONE,
  DEFAULT_COLLECTION_CLOSING_TIME,
  DEFAULT_COLLECTION_OPENING_TIME,
} from "@/config/home-collection";
import {
  isValidTimeString,
  isValidTimeZone,
} from "@/lib/utils/booking-time";

/**
 * Laboratory model - a registered diagnostic facility.
 *
 * Denormalised contact and address fields belong to the laboratory itself;
 * departments and tests reference this document by ObjectId instead of
 * copying its name. Authentication data never lives here.
 */

/**
 * Online-booking configuration. Absent (`undefined`) means the laboratory has
 * not configured online booking - the booking module shows an explicit
 * unavailable state instead of inventing slots. It is only created when an
 * administrator saves it through the laboratory form or API.
 */
export interface LaboratoryBookingConfig {
  /** IANA timezone used to interpret booking dates and slots. */
  timezone: string;
  /** Weekday indexes (0 = Sunday … 6 = Saturday) the laboratory operates. */
  operatingDays: number[];
  /** First slot start of the day, `HH:mm`. */
  openingTime: string;
  /** Day boundary after the last slot, `HH:mm`. */
  closingTime: string;
  slotDurationMinutes: number;
  /** Bookings allowed per slot. */
  slotCapacity: number;
  /** How many days ahead patients may book. */
  maxAdvanceDays: number;
}

/**
 * Home sample-collection schedule (STEP 8). Structurally identical to the
 * booking configuration but stored separately so collection capacity and
 * hours can differ from in-lab booking capacity - a home visit reserves a
 * field collector's time, not a draw chair. Absent means the laboratory has
 * not enabled home collection.
 */
export type LaboratoryHomeCollectionConfig = LaboratoryBookingConfig;

export interface LaboratoryRecord {
  name: string;
  /** Business code, stored normalised (uppercase, hyphenated). */
  code: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  registrationNumber: string | null;
  accreditation: string | null;
  bookingConfig?: LaboratoryBookingConfig;
  /** Present only when the laboratory has enabled home collection. */
  homeCollectionConfig?: LaboratoryHomeCollectionConfig;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/** Shared normalisation applied to user-supplied text fields. */
function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Builds the schedule-config sub-schema used by both `bookingConfig` (STEP 7)
 * and `homeCollectionConfig` (STEP 8). The two documents track different
 * operational capacities but share the same field shape and validators.
 */
function createScheduleConfigSchema<T extends LaboratoryBookingConfig>(
  defaults: {
    timezone: string;
    operatingDays: readonly number[];
    openingTime: string;
    closingTime: string;
    slotDurationMinutes: number;
    slotCapacity: number;
    maxAdvanceDays: number;
  },
) {
  return new Schema<T>(
    {
      timezone: {
        type: String,
        required: true,
        trim: true,
        maxlength: 64,
        default: defaults.timezone,
        validate: {
          validator: (value: string) => isValidTimeZone(value),
          message: "Enter a valid IANA timezone (e.g. Asia/Kolkata).",
        },
      },
      operatingDays: {
        type: [Number],
        required: true,
        default: () => [...defaults.operatingDays],
        validate: {
          validator: (value: number[]) =>
            Array.isArray(value) &&
            value.length > 0 &&
            value.length <= 7 &&
            value.every(
              (day) => Number.isInteger(day) && day >= 0 && day <= 6,
            ) &&
            new Set(value).size === value.length,
          message:
            "Operating days must be unique weekday indexes between 0 and 6.",
        },
      },
      openingTime: {
        type: String,
        required: true,
        trim: true,
        default: defaults.openingTime,
        validate: {
          validator: (value: string) => isValidTimeString(value),
          message: "Opening time must be in HH:mm format.",
        },
      },
      closingTime: {
        type: String,
        required: true,
        trim: true,
        default: defaults.closingTime,
        validate: {
          validator: (value: string) => isValidTimeString(value),
          message: "Closing time must be in HH:mm format.",
        },
      },
      slotDurationMinutes: {
        type: Number,
        required: true,
        min: SLOT_DURATION_MINUTES_MIN,
        max: SLOT_DURATION_MINUTES_MAX,
        default: defaults.slotDurationMinutes,
      },
      slotCapacity: {
        type: Number,
        required: true,
        min: SLOT_CAPACITY_MIN,
        max: SLOT_CAPACITY_MAX,
        default: defaults.slotCapacity,
      },
      maxAdvanceDays: {
        type: Number,
        required: true,
        min: MAX_ADVANCE_DAYS_MIN,
        max: MAX_ADVANCE_DAYS_MAX,
        default: defaults.maxAdvanceDays,
      },
    },
    { _id: false },
  );
}

/** Closing-after-opening coherence check shared by both configurations. */
const scheduleConfigOrderValidator = {
  validator: (config: LaboratoryBookingConfig | undefined) => {
    if (!config) return true;
    if (!isValidTimeString(config.openingTime)) return false;
    if (!isValidTimeString(config.closingTime)) return false;
    const toMinutes = (value: string): number => {
      const [hour, minute] = value.split(":").map(Number);
      return hour * 60 + minute;
    };
    return toMinutes(config.closingTime) > toMinutes(config.openingTime);
  },
  message: "Closing time must be later than the opening time.",
};

const bookingScheduleSchema = createScheduleConfigSchema<LaboratoryBookingConfig>(
  {
    timezone: DEFAULT_BOOKING_TIMEZONE,
    operatingDays: DEFAULT_OPERATING_DAYS,
    openingTime: DEFAULT_OPENING_TIME,
    closingTime: DEFAULT_CLOSING_TIME,
    slotDurationMinutes: DEFAULT_SLOT_DURATION_MINUTES,
    slotCapacity: DEFAULT_SLOT_CAPACITY,
    maxAdvanceDays: DEFAULT_MAX_ADVANCE_DAYS,
  },
);

const homeCollectionScheduleSchema =
  createScheduleConfigSchema<LaboratoryHomeCollectionConfig>({
    timezone: DEFAULT_COLLECTION_TIMEZONE,
    operatingDays: DEFAULT_COLLECTION_OPERATING_DAYS,
    openingTime: DEFAULT_COLLECTION_OPENING_TIME,
    closingTime: DEFAULT_COLLECTION_CLOSING_TIME,
    slotDurationMinutes: DEFAULT_COLLECTION_SLOT_DURATION_MINUTES,
    slotCapacity: DEFAULT_COLLECTION_SLOT_CAPACITY,
    maxAdvanceDays: DEFAULT_COLLECTION_MAX_ADVANCE_DAYS,
  });

const laboratorySchema = new Schema<LaboratoryRecord>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120,
    },
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 32,
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 20,
      default: null,
      set: cleanText,
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      maxlength: 254,
      default: null,
      set: cleanText,
    },
    address: {
      type: String,
      trim: true,
      maxlength: 240,
      default: null,
      set: cleanText,
    },
    city: {
      type: String,
      trim: true,
      maxlength: 80,
      default: null,
      set: cleanText,
    },
    state: {
      type: String,
      trim: true,
      maxlength: 80,
      default: null,
      set: cleanText,
    },
    pincode: {
      type: String,
      trim: true,
      maxlength: 12,
      default: null,
      set: cleanText,
    },
    registrationNumber: {
      type: String,
      trim: true,
      maxlength: 64,
      default: null,
      set: cleanText,
    },
    accreditation: {
      type: String,
      trim: true,
      maxlength: 160,
      default: null,
      set: cleanText,
    },
    bookingConfig: {
      type: bookingScheduleSchema,
      // No default: labs created before online booking stay explicitly
      // "not configured" until an admin saves a configuration.
      default: undefined,
      validate: scheduleConfigOrderValidator,
    },
    homeCollectionConfig: {
      type: homeCollectionScheduleSchema,
      // No default: labs created before STEP 8 stay explicitly
      // "not enabled" until an admin saves a configuration.
      default: undefined,
      validate: scheduleConfigOrderValidator,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

/**
 * Indexes: `code` is unique via the field definition above. Additional
 * indexes cover directory search and the status filter.
 */
laboratorySchema.index({ name: 1 });
laboratorySchema.index({ city: 1 });
laboratorySchema.index({ isActive: 1 });
laboratorySchema.index({ createdAt: -1 });

export type LaboratoryDocument = HydratedDocument<LaboratoryRecord>;

/** Registered through the `getModel` helper (HMR-idempotent). */
export const Laboratory = getModel<LaboratoryRecord>(
  "Laboratory",
  laboratorySchema,
);
