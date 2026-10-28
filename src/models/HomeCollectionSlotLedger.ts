import { Schema, type HydratedDocument, type Types } from "mongoose";

import { getModel } from "@/lib/db";

/**
 * Home-collection slot capacity ledger - the concurrency guard for pickup
 * requests (STEP 8).
 *
 * Deliberately DISTINCT from `LabSlotLedger`: home collection reserves a
 * field collector's time, not an in-lab draw chair, so the two capacities
 * are tracked separately even when a laboratory offers both services.
 *
 * One document per (laboratory, calendar date, slot start) tracks how many
 * capacity-holding collection requests currently occupy that slot. A request
 * claims capacity with a single atomic `findOneAndUpdate` guarded by
 * `taken < capacity` (see `src/lib/home-collection/slots.ts`). Because
 * MongoDB executes that update atomically per document, two concurrent
 * requests can never both read the same count and both insert - the classic
 * check-then-insert race is closed without requiring replica-set
 * transactions.
 *
 * Cancelled or failed requests release their hold (`$inc` back down, floored
 * at zero). The ledger is an operational bookkeeping record - it is never
 * used to display history (the HomeCollection documents are).
 */
export interface HomeCollectionSlotLedgerRecord {
  laboratoryId: Types.ObjectId;
  /** Calendar date the slot belongs to (UTC midnight of that date). */
  scheduledDate: Date;
  /** Slot start in the laboratory's timezone, `HH:mm`. */
  timeSlot: string;
  /** Number of capacity-holding collection requests in this slot. */
  taken: number;
  createdAt: Date;
  updatedAt: Date;
}

const homeCollectionSlotLedgerSchema = new Schema<HomeCollectionSlotLedgerRecord>(
  {
    laboratoryId: {
      type: Schema.Types.ObjectId,
      ref: "Laboratory",
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
    taken: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

/**
 * Unique compound index doubles as the race arbiter: concurrent first
 * claims for the same slot produce exactly one insert; the loser receives a
 * duplicate-key error and retries against the now-existing document.
 */
homeCollectionSlotLedgerSchema.index(
  { laboratoryId: 1, scheduledDate: 1, timeSlot: 1 },
  { unique: true },
);

export type HomeCollectionSlotLedgerDocument =
  HydratedDocument<HomeCollectionSlotLedgerRecord>;

/** Registered through the `getModel` helper (HMR-idempotent). */
export const HomeCollectionSlotLedger = getModel<HomeCollectionSlotLedgerRecord>(
  "HomeCollectionSlotLedger",
  homeCollectionSlotLedgerSchema,
);
