import { Schema, type HydratedDocument, type Types } from "mongoose";

import { getModel } from "@/lib/db";
import {
  COLLECTION_EVENT_TYPES,
  COLLECTION_STATUSES,
} from "@/config/home-collection";

/**
 * HomeCollectionEvent - append-only audit trail for collection lifecycle
 * events (STEP 8).
 *
 * Events are written exclusively on the server by the routes that perform
 * the action; clients can never fabricate actors or timestamps. Metadata is
 * limited to operationally safe keys (e.g. the reassigned collector's id) -
 * no patient address, phone or other sensitive payload is ever stored here.
 *
 * A separate collection (not an embedded array) keeps the parent document
 * lean under repeated status changes and allows independent indexing by
 * collection + time.
 */
export interface HomeCollectionEventRecord {
  collectionId: Types.ObjectId;
  eventType: (typeof COLLECTION_EVENT_TYPES)[number];
  previousStatus: (typeof COLLECTION_STATUSES)[number] | null;
  newStatus: (typeof COLLECTION_STATUSES)[number] | null;
  /** User who performed the action (server-derived from the session). */
  actorId: Types.ObjectId;
  /** Safe auxiliary data, e.g. `{ collectorId }` on reassignment. */
  metadata: Record<string, string | number | boolean> | null;
  createdAt: Date;
  updatedAt: Date;
}

const homeCollectionEventSchema = new Schema<HomeCollectionEventRecord>(
  {
    collectionId: {
      type: Schema.Types.ObjectId,
      ref: "HomeCollection",
      required: true,
    },
    eventType: {
      type: String,
      enum: [...COLLECTION_EVENT_TYPES],
      required: true,
    },
    previousStatus: {
      type: String,
      enum: [...COLLECTION_STATUSES],
      default: null,
    },
    newStatus: {
      type: String,
      enum: [...COLLECTION_STATUSES],
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
homeCollectionEventSchema.index({ collectionId: 1, createdAt: -1 });

export type HomeCollectionEventDocument =
  HydratedDocument<HomeCollectionEventRecord>;

/** Registered through the `getModel` helper (HMR-idempotent). */
export const HomeCollectionEvent = getModel<HomeCollectionEventRecord>(
  "HomeCollectionEvent",
  homeCollectionEventSchema,
);
