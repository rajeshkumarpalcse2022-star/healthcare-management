import { Schema, type HydratedDocument, type Types } from "mongoose";

import { getModel } from "@/lib/db";
import {
  COLLECTION_NOTE_MAX_LENGTH,
  COLLECTION_STATUSES,
  ADDRESS_LINE_MAX_LENGTH,
  ADDRESS_CITY_MAX_LENGTH,
  ADDRESS_STATE_MAX_LENGTH,
  ADDRESS_LANDMARK_MAX_LENGTH,
  ADDRESS_INSTRUCTIONS_MAX_LENGTH,
  ADDRESS_NAME_MAX_LENGTH,
} from "@/config/home-collection";

/**
 * HomeCollection model - one home sample-collection request (STEP 8).
 *
 * Identity: `patientId` references the authenticated PATIENT-role user
 * account that owns the request (same convention as LabBooking - the
 * platform's Patient Management module is still a placeholder, and the
 * PATIENT user IS the patient record).
 *
 * Snapshot policy: each item copies the test's code, name and price at
 * request time; `collectionAddress` and `patientContactSnapshot` copy the
 * pickup details so operations keep working if the patient profile changes.
 * No full Patient, Laboratory, User or LabTest document is duplicated.
 *
 * Money: `item.price` is computed exclusively on the server from trusted
 * LabTest records and is informational only - this module records NO
 * payment state and charges no home-collection fee.
 *
 * Booking link: `labBookingId` is optional. When present, the booking must
 * belong to the same patient and laboratory and be in a compatible state;
 * the original booking status is never modified. `activeBookingLinkKey`
 * carries a partial-unique concurrency guard: only one capacity-holding
 * collection may reference a given booking at a time.
 *
 * Retry policy: FAILED requests are terminal. A retry is a NEW request that
 * stores `retryOfId` pointing at the failed original, so the original audit
 * history is never rewritten.
 */
export interface HomeCollectionItemSnapshot {
  labTestId: Types.ObjectId;
  /** Business code at request time. */
  testCode: string;
  /** Display name at request time. */
  testName: string;
  /** Catalogue price at request time (informational; no payment recorded). */
  price: number;
  /** Specimen type at request time (e.g. Blood, Serum) - shown to collectors. */
  specimenType: string | null;
  /** Preparation instructions at request time (e.g. fasting). */
  preparationInstructions: string | null;
}

/**
 * Pickup address snapshot. GPS coordinates are optional - the platform never
 * invents geolocation and never requires it.
 */
export interface HomeCollectionAddress {
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  /** Indian 6-digit PIN code. */
  pincode: string;
  latitude: number | null;
  longitude: number | null;
  instructions: string | null;
}

export interface HomeCollectionContactSnapshot {
  name: string;
  phone: string | null;
}

export interface HomeCollectionRecord {
  /** Unique reference shown to patients and staff, e.g. `HC-2026-000001`. */
  collectionCode: string;
  /** Owning patient (PATIENT-role User). Resolved server-side from session. */
  patientId: Types.ObjectId;
  laboratoryId: Types.ObjectId;
  /** Optional link to an eligible STEP 7 lab booking. */
  labBookingId: Types.ObjectId | null;
  items: HomeCollectionItemSnapshot[];
  collectionAddress: HomeCollectionAddress;
  /** Scheduled calendar date (UTC midnight of that date, lab-local meaning). */
  scheduledDate: Date;
  /** Slot start in the laboratory timezone, `HH:mm`. */
  timeSlot: string;
  /** Laboratory timezone captured at request time. */
  timezone: string;
  status: (typeof COLLECTION_STATUSES)[number];
  /** Optional assigned collector (COLLECTOR-role User). */
  assignedCollectorId: Types.ObjectId | null;
  patientContactSnapshot: HomeCollectionContactSnapshot;
  collectionNotes: string | null;
  cancellationReason: string | null;
  cancelledAt: Date | null;
  /** Lab manager (or above) who accepted the request. */
  reviewedBy: Types.ObjectId | null;
  reviewedAt: Date | null;
  /** Required when the request is rejected. */
  rejectionReason: string | null;
  assignedAt: Date | null;
  /** User who assigned (or reassigned) the collector. */
  assignedBy: Types.ObjectId | null;
  /** Collector accepted the assignment and will perform the pickup. */
  collectorAcceptedAt: Date | null;
  enRouteAt: Date | null;
  arrivedAt: Date | null;
  collectedAt: Date | null;
  failedAt: Date | null;
  failureReason: string | null;
  /**
   * OTP verification metadata. Only the SHA-256 hash of the OTP is stored -
   * the plaintext is returned exactly once to the patient at creation and is
   * never readable from list or detail APIs afterwards.
   */
  otpHash: string | null;
  otpExpiresAt: Date | null;
  /** When the current OTP was issued - powers the regenerate cooldown. */
  otpIssuedAt: Date | null;
  otpAttempts: number;
  otpMaxAttempts: number;
  otpVerifiedAt: Date | null;
  /** Link to the failed original when this request is a retry. */
  retryOfId: Types.ObjectId | null;
  /**
   * Concurrency guard for "one active collection per booking": the linked
   * booking's id while this request holds capacity, `null` otherwise.
   * Backed by a partial unique index - see the index block below.
   */
  activeBookingLinkKey: string | null;
  /** User who created the request (the patient, or staff on their behalf). */
  createdBy: Types.ObjectId;
  /** Optional client-supplied key that makes retried submissions idempotent. */
  idempotencyKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const itemSnapshotSchema = new Schema<HomeCollectionItemSnapshot>(
  {
    labTestId: {
      type: Schema.Types.ObjectId,
      ref: "LabTest",
      required: true,
    },
    testCode: {
      type: String,
      required: true,
      trim: true,
      maxlength: 32,
    },
    testName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    specimenType: {
      type: String,
      trim: true,
      maxlength: 64,
      default: null,
    },
    preparationInstructions: {
      type: String,
      trim: true,
      maxlength: 1_000,
      default: null,
      set: cleanText,
    },
  },
  { _id: false },
);

const collectionAddressSchema = new Schema<HomeCollectionAddress>(
  {
    recipientName: {
      type: String,
      required: true,
      trim: true,
      maxlength: ADDRESS_NAME_MAX_LENGTH,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20,
    },
    addressLine1: {
      type: String,
      required: true,
      trim: true,
      maxlength: ADDRESS_LINE_MAX_LENGTH,
    },
    addressLine2: {
      type: String,
      trim: true,
      maxlength: ADDRESS_LINE_MAX_LENGTH,
      default: null,
      set: cleanText,
    },
    landmark: {
      type: String,
      trim: true,
      maxlength: ADDRESS_LANDMARK_MAX_LENGTH,
      default: null,
      set: cleanText,
    },
    city: {
      type: String,
      required: true,
      trim: true,
      maxlength: ADDRESS_CITY_MAX_LENGTH,
    },
    state: {
      type: String,
      required: true,
      trim: true,
      maxlength: ADDRESS_STATE_MAX_LENGTH,
    },
    pincode: {
      type: String,
      required: true,
      trim: true,
      maxlength: 6,
      match: /^[1-9][0-9]{5}$/,
    },
    latitude: {
      type: Number,
      min: -90,
      max: 90,
      default: null,
    },
    longitude: {
      type: Number,
      min: -180,
      max: 180,
      default: null,
    },
    instructions: {
      type: String,
      trim: true,
      maxlength: ADDRESS_INSTRUCTIONS_MAX_LENGTH,
      default: null,
      set: cleanText,
    },
  },
  { _id: false },
);

const contactSnapshotSchema = new Schema<HomeCollectionContactSnapshot>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 20,
      default: null,
      set: cleanText,
    },
  },
  { _id: false },
);

const homeCollectionSchema = new Schema<HomeCollectionRecord>(
  {
    collectionCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      maxlength: 32,
    },
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    laboratoryId: {
      type: Schema.Types.ObjectId,
      ref: "Laboratory",
      required: true,
    },
    labBookingId: {
      type: Schema.Types.ObjectId,
      ref: "LabBooking",
      default: null,
    },
    items: {
      type: [itemSnapshotSchema],
      required: true,
      validate: {
        validator: (value: HomeCollectionItemSnapshot[]) =>
          Array.isArray(value) && value.length > 0 && value.length <= 20,
        message: "A collection request must contain between 1 and 20 tests.",
      },
    },
    collectionAddress: {
      type: collectionAddressSchema,
      required: true,
    },
    scheduledDate: {
      type: Date,
      required: true,
    },
    timeSlot: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):[0-5]\d$/,
    },
    timezone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 64,
    },
    status: {
      type: String,
      enum: [...COLLECTION_STATUSES],
      required: true,
      default: "PENDING",
    },
    assignedCollectorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    patientContactSnapshot: {
      type: contactSnapshotSchema,
      required: true,
    },
    collectionNotes: {
      type: String,
      trim: true,
      maxlength: COLLECTION_NOTE_MAX_LENGTH,
      default: null,
      set: cleanText,
    },
    cancellationReason: {
      type: String,
      trim: true,
      maxlength: COLLECTION_NOTE_MAX_LENGTH,
      default: null,
      set: cleanText,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: COLLECTION_NOTE_MAX_LENGTH,
      default: null,
      set: cleanText,
    },
    assignedAt: {
      type: Date,
      default: null,
    },
    assignedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    collectorAcceptedAt: {
      type: Date,
      default: null,
    },
    enRouteAt: {
      type: Date,
      default: null,
    },
    arrivedAt: {
      type: Date,
      default: null,
    },
    collectedAt: {
      type: Date,
      default: null,
    },
    otpHash: {
      type: String,
      trim: true,
      maxlength: 128,
      default: null,
      select: false,
    },
    otpExpiresAt: {
      type: Date,
      default: null,
      select: false,
    },
    otpIssuedAt: {
      type: Date,
      default: null,
      select: false,
    },
    otpAttempts: {
      type: Number,
      default: 0,
      min: 0,
      select: false,
    },
    otpMaxAttempts: {
      type: Number,
      default: 5,
      min: 1,
      select: false,
    },
    otpVerifiedAt: {
      type: Date,
      default: null,
      select: false,
    },
    failedAt: {
      type: Date,
      default: null,
    },
    failureReason: {
      type: String,
      trim: true,
      maxlength: COLLECTION_NOTE_MAX_LENGTH,
      default: null,
      set: cleanText,
    },
    retryOfId: {
      type: Schema.Types.ObjectId,
      ref: "HomeCollection",
      default: null,
    },
    activeBookingLinkKey: {
      type: String,
      trim: true,
      maxlength: 64,
      default: null,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    idempotencyKey: {
      type: String,
      trim: true,
      maxlength: 100,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

/**
 * Indexes: `collectionCode` uniqueness comes from the field definition.
 * `idempotencyKey` and `activeBookingLinkKey` get *partial* unique indexes -
 * only real strings are indexed, so the `null` stored for standalone
 * requests (or non-holding statuses) can never collide.
 */
homeCollectionSchema.index(
  { idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } },
);
homeCollectionSchema.index(
  { activeBookingLinkKey: 1 },
  {
    unique: true,
    partialFilterExpression: { activeBookingLinkKey: { $type: "string" } },
  },
);
homeCollectionSchema.index({ patientId: 1, createdAt: -1 });
homeCollectionSchema.index({ laboratoryId: 1, scheduledDate: 1 });
homeCollectionSchema.index({ status: 1, scheduledDate: 1 });
homeCollectionSchema.index({ assignedCollectorId: 1, scheduledDate: 1 });
homeCollectionSchema.index({ createdAt: -1 });

export type HomeCollectionDocument = HydratedDocument<HomeCollectionRecord>;

/** Registered through the `getModel` helper (HMR-idempotent). */
export const HomeCollection = getModel<HomeCollectionRecord>(
  "HomeCollection",
  homeCollectionSchema,
);
