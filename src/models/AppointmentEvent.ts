import { Schema, type HydratedDocument, type Types } from "mongoose";

import {
  APPOINTMENT_EVENT_TYPES,
  APPOINTMENT_STATUSES,
} from "@/config/appointments";
import { getModel } from "@/lib/db";

/**
 * AppointmentEvent - append-only audit trail for appointment lifecycle
 * events (request, review, cancellation, reschedule, consultation start,
 * completion).
 *
 * Mirrors `LabBookingEvent` exactly so both request types expose the same
 * status-history shape in detail pages and history lists. Events are written
 * exclusively on the server by the routes that perform the action; clients
 * can never fabricate actors or timestamps. Metadata is limited to
 * operationally safe keys (reason excerpt, reschedule target) - no patient
 * address, phone or clinical data is ever stored here.
 *
 * A separate collection (not an embedded array) keeps the parent document
 * lean under repeated status changes and allows independent indexing by
 * appointment + time.
 */
export interface AppointmentEventRecord {
  appointmentId: Types.ObjectId;
  eventType: (typeof APPOINTMENT_EVENT_TYPES)[number];
  previousStatus: (typeof APPOINTMENT_STATUSES)[number] | null;
  newStatus: (typeof APPOINTMENT_STATUSES)[number] | null;
  /** User who performed the action (server-derived from the session). */
  actorId: Types.ObjectId;
  /** Safe auxiliary data, e.g. `{ reason }` on rejection. */
  metadata: Record<string, string | number | boolean> | null;
  createdAt: Date;
  updatedAt: Date;
}

const appointmentEventSchema = new Schema<AppointmentEventRecord>(
  {
    appointmentId: {
      type: Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
    },
    eventType: {
      type: String,
      enum: [...APPOINTMENT_EVENT_TYPES],
      required: true,
    },
    previousStatus: {
      type: String,
      enum: [...APPOINTMENT_STATUSES],
      default: null,
    },
    newStatus: {
      type: String,
      enum: [...APPOINTMENT_STATUSES],
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
appointmentEventSchema.index({ appointmentId: 1, createdAt: -1 });

export type AppointmentEventDocument = HydratedDocument<AppointmentEventRecord>;

/** Registered through the `getModel` helper (HMR-idempotent). */
export const AppointmentEvent = getModel<AppointmentEventRecord>(
  "AppointmentEvent",
  appointmentEventSchema,
);
