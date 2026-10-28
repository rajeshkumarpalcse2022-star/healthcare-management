import { Schema, type HydratedDocument, type Types } from "mongoose";

import { getModel } from "@/lib/db";
import {
  BOOKING_EVENT_TYPES,
  BOOKING_STATUSES,
} from "@/config/lab-bookings";

/**
 * LabBookingEvent - append-only audit trail for lab-visit request lifecycle
 * events (central Collection Requests review).
 *
 * Mirrors `HomeCollectionEvent` exactly so both request types expose the same
 * status history shape in the review queue, the detail pages and the patient
 * history. Events are written exclusively on the server by the routes that
 * perform the action; clients can never fabricate actors or timestamps.
 * Metadata is limited to operationally safe keys (e.g. the rejection reason
 * excerpt) - no patient address, phone or credentials are ever stored here.
 *
 * A separate collection (not an embedded array) keeps the parent document
 * lean under repeated status changes and allows independent indexing by
 * booking + time.
 */
export interface LabBookingEventRecord {
  bookingId: Types.ObjectId;
  eventType: (typeof BOOKING_EVENT_TYPES)[number];
  previousStatus: (typeof BOOKING_STATUSES)[number] | null;
  newStatus: (typeof BOOKING_STATUSES)[number] | null;
  /** User who performed the action (server-derived from the session). */
  actorId: Types.ObjectId;
  /** Safe auxiliary data, e.g. `{ reason }` on rejection. */
  metadata: Record<string, string | number | boolean> | null;
  createdAt: Date;
  updatedAt: Date;
}

const labBookingEventSchema = new Schema<LabBookingEventRecord>(
  {
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: "LabBooking",
      required: true,
    },
    eventType: {
      type: String,
      enum: [...BOOKING_EVENT_TYPES],
      required: true,
    },
    previousStatus: {
      type: String,
      enum: [...BOOKING_STATUSES],
      default: null,
    },
    newStatus: {
      type: String,
      enum: [...BOOKING_STATUSES],
      default: null,
    },
    actorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

/** Timeline lookups for the detail view. */
labBookingEventSchema.index({ bookingId: 1, createdAt: -1 });

export type LabBookingEventDocument = HydratedDocument<LabBookingEventRecord>;

/** Registered through the `getModel` helper (HMR-idempotent). */
export const LabBookingEvent = getModel<LabBookingEventRecord>(
  "LabBookingEvent",
  labBookingEventSchema,
);
