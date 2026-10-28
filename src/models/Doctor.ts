import { Schema, type HydratedDocument, type Types } from "mongoose";

import {
  DEFAULT_APPOINTMENT_CLOSING_TIME,
  DEFAULT_APPOINTMENT_MAX_ADVANCE_DAYS,
  DEFAULT_APPOINTMENT_OPENING_TIME,
  DEFAULT_APPOINTMENT_OPERATING_DAYS,
  DEFAULT_APPOINTMENT_SLOT_CAPACITY,
  DEFAULT_APPOINTMENT_SLOT_DURATION_MINUTES,
  DEFAULT_APPOINTMENT_TIMEZONE,
} from "@/config/appointments";
import { DOCTOR_GENDERS } from "@/config/doctors";
import { getModel } from "@/lib/db";
import { isValidTimeZone } from "@/lib/utils/booking-time";
import type { DoctorScheduleConfig } from "@/types/appointment";

/**
 * Doctor model - professional profile data only.
 *
 * Authentication stays exclusively in the User model (`passwordHash`, login
 * email handling, sessions). `userId` is an optional pointer to a login
 * account when one exists; it is never required to store a doctor profile.
 *
 * Clinic relationship: `clinicId` is the primary clinic and `clinicIds`
 * lists every clinic the doctor practises at. Keeping the primary field
 * preserves older records and compact UI surfaces; the shared helper treats
 * `[clinicId]` as the assignment list when `clinicIds` is missing.
 *
 * Schedule: `scheduleConfig` is the legacy primary-clinic schedule, while
 * `clinicSchedules` stores one independent configuration per clinic. Absent
 * schedules mean availability is never invented for that clinic.
 */
export interface DoctorClinicScheduleRecord {
  clinicId: Types.ObjectId;
  scheduleConfig: DoctorScheduleConfig;
}

export interface DoctorRecord {
  /** Optional link to the login account (User). Never holds credentials. */
  userId: Types.ObjectId | null;
  /** Primary clinic this doctor practises at. */
  clinicId: Types.ObjectId;
  /** Every assigned clinic, primary first when populated by this app. */
  clinicIds?: Types.ObjectId[];
  doctorCode: string;
  name: string;
  /** Normalised (trimmed + lowercased) contact email. */
  email: string;
  phone: string | null;
  specialization: string;
  qualification: string | null;
  registrationNumber: string | null;
  experienceYears: number | null;
  consultationFee: number | null;
  gender: (typeof DOCTOR_GENDERS)[number] | null;
  dateOfBirth: Date | null;
  bio: string | null;
  profileImageUrl: string | null;
  /** Legacy primary-clinic availability; absent until configured. */
  scheduleConfig?: DoctorScheduleConfig;
  /** Per-clinic availability for multi-clinic doctors. */
  clinicSchedules?: DoctorClinicScheduleRecord[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const breakWindowSchema = new Schema<DoctorScheduleConfig["breaks"][number]>(
  {
    start: {
      type: String,
      required: true,
      trim: true,
      match: [TIME_PATTERN, "Break start must be in HH:mm format."],
    },
    end: {
      type: String,
      required: true,
      trim: true,
      match: [TIME_PATTERN, "Break end must be in HH:mm format."],
    },
  },
  { _id: false },
);

const dateOverrideSchema = new Schema<
  DoctorScheduleConfig["dateOverrides"][number]
>(
  {
    date: {
      type: String,
      required: true,
      trim: true,
      match: [DATE_PATTERN, "Date override must use YYYY-MM-DD."],
    },
    isClosed: {
      type: Boolean,
      default: false,
    },
    openingTime: {
      type: String,
      required: true,
      trim: true,
      match: [TIME_PATTERN, "Opening time must be in HH:mm format."],
      default: DEFAULT_APPOINTMENT_OPENING_TIME,
    },
    closingTime: {
      type: String,
      required: true,
      trim: true,
      match: [TIME_PATTERN, "Closing time must be in HH:mm format."],
      default: DEFAULT_APPOINTMENT_CLOSING_TIME,
    },
    slotDurationMinutes: {
      type: Number,
      required: true,
      min: 15,
      max: 480,
      default: DEFAULT_APPOINTMENT_SLOT_DURATION_MINUTES,
    },
    slotCapacity: {
      type: Number,
      required: true,
      min: 1,
      max: 50,
      default: DEFAULT_APPOINTMENT_SLOT_CAPACITY,
    },
    breaks: {
      type: [breakWindowSchema],
      default: () => [],
    },
  },
  { _id: false },
);

/**
 * Schedule-config sub-schema for appointment availability. Same field shape
 * as the laboratory booking configuration plus breaks, date-specific
 * unavailability, special-date hours and per-clinic seat capacity.
 */
const scheduleConfigSchema = new Schema<DoctorScheduleConfig>(
  {
    timezone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
      default: DEFAULT_APPOINTMENT_TIMEZONE,
      validate: {
        validator: (value: string) => isValidTimeZone(value),
        message: "Enter a valid IANA timezone (e.g. Asia/Kolkata).",
      },
    },
    operatingDays: {
      type: [Number],
      required: true,
      default: () => [...DEFAULT_APPOINTMENT_OPERATING_DAYS],
      validate: {
        validator: (value: number[]) =>
          Array.isArray(value) &&
          value.length > 0 &&
          value.length <= 7 &&
          new Set(value).size === value.length &&
          value.every(
            (day) => Number.isInteger(day) && day >= 0 && day <= 6,
          ),
        message:
          "Select 1-7 distinct weekday indexes between 0 (Sunday) and 6 (Saturday).",
      },
    },
    openingTime: {
      type: String,
      required: true,
      trim: true,
      match: [TIME_PATTERN, "Opening time must be in HH:mm format."],
      default: DEFAULT_APPOINTMENT_OPENING_TIME,
    },
    closingTime: {
      type: String,
      required: true,
      trim: true,
      match: [TIME_PATTERN, "Closing time must be in HH:mm format."],
      default: DEFAULT_APPOINTMENT_CLOSING_TIME,
    },
    slotDurationMinutes: {
      type: Number,
      required: true,
      min: 15,
      max: 480,
      default: DEFAULT_APPOINTMENT_SLOT_DURATION_MINUTES,
    },
    slotCapacity: {
      type: Number,
      required: true,
      min: 1,
      max: 50,
      default: DEFAULT_APPOINTMENT_SLOT_CAPACITY,
    },
    maxAdvanceDays: {
      type: Number,
      required: true,
      min: 1,
      max: 90,
      default: DEFAULT_APPOINTMENT_MAX_ADVANCE_DAYS,
    },
    breaks: {
      type: [breakWindowSchema],
      default: () => [],
      validate: {
        validator: (value: DoctorScheduleConfig["breaks"]) =>
          Array.isArray(value) &&
          value.length <= 10 &&
          value.every((entry) => entry.end > entry.start),
        message:
          "Configure at most 10 breaks, each ending later than it starts.",
      },
    },
    unavailableDates: {
      type: [String],
      default: () => [],
      validate: {
        validator: (value: string[]) =>
          Array.isArray(value) &&
          value.length <= 100 &&
          new Set(value).size === value.length &&
          value.every((date) => DATE_PATTERN.test(date)),
        message:
          "Mark at most 100 distinct unavailable dates in YYYY-MM-DD format.",
      },
    },
    dateOverrides: {
      type: [dateOverrideSchema],
      default: () => [],
      validate: {
        validator: (value: DoctorScheduleConfig["dateOverrides"]) =>
          Array.isArray(value) &&
          value.length <= 60 &&
          new Set(value.map((entry) => entry.date)).size === value.length &&
          value.every(
            (entry) =>
              entry.isClosed ||
              (entry.closingTime > entry.openingTime &&
                entry.breaks.every((item) => item.end > item.start)),
          ),
        message:
          "Configure at most 60 distinct date overrides with valid hours.",
      },
    },
  },
  { _id: false },
);

const clinicScheduleSchema = new Schema<DoctorClinicScheduleRecord>(
  {
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
    },
    scheduleConfig: {
      type: scheduleConfigSchema,
      required: true,
    },
  },
  { _id: false },
);

const doctorSchema = new Schema<DoctorRecord>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
    },
    clinicIds: {
      type: [
        {
          type: Schema.Types.ObjectId,
          ref: "Clinic",
        },
      ],
      default: undefined,
    },
    doctorCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 32,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 20,
      default: null,
      set: cleanText,
    },
    specialization: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    qualification: {
      type: String,
      trim: true,
      maxlength: 160,
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
    experienceYears: {
      type: Number,
      min: 0,
      max: 60,
      default: null,
    },
    consultationFee: {
      type: Number,
      min: 0,
      default: null,
    },
    gender: {
      type: String,
      enum: [...DOCTOR_GENDERS],
      default: null,
    },
    dateOfBirth: {
      type: Date,
      default: null,
    },
    bio: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: null,
      set: cleanText,
    },
    profileImageUrl: {
      type: String,
      trim: true,
      maxlength: 800,
      default: null,
      set: cleanText,
    },
    scheduleConfig: {
      type: scheduleConfigSchema,
      required: false,
      default: undefined,
    },
    clinicSchedules: {
      type: [clinicScheduleSchema],
      default: undefined,
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
 * Indexes: `doctorCode` is unique via the field definition above.
 * Additional indexes cover the clinic filter, specialisation filter, contact
 * lookup, status filter and the DOCTOR-role self lookup.
 */
doctorSchema.index({ clinicId: 1 });
doctorSchema.index({ clinicIds: 1 });
doctorSchema.index({ specialization: 1 });
doctorSchema.index({ email: 1 });
doctorSchema.index({ isActive: 1 });
doctorSchema.index({ createdAt: -1 });
doctorSchema.index({ userId: 1 });

export type DoctorDocument = HydratedDocument<DoctorRecord>;

/** Registered through the `getModel` helper (HMR-idempotent). */
export const Doctor = getModel<DoctorRecord>("Doctor", doctorSchema);
