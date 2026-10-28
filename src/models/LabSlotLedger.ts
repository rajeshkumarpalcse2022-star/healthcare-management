import { Schema, type HydratedDocument, type Types } from "mongoose";

import { getModel } from "@/lib/db";

/**
 * Slot capacity ledger - the concurrency guard for laboratory bookings.
 *
 * One document per (laboratory, calendar date, slot start) tracks how many
 * active bookings currently occupy that slot. A booking claims capacity with
 * a single atomic `findOneAndUpdate` guarded by `taken < capacity` (see
 * `src/lib/lab-booking/slots.ts`). Because MongoDB executes that update
 * atomically per document, two concurrent requests can never both read the
 * same count and both insert - the classic check-then-insert race is closed
 * without requiring replica-set transactions.
 *
 * Cancelled bookings release their hold (`$inc` back down, floored at zero).
 * The ledger is an operational bookkeeping record - it is never used to
 * display history (the LabBooking documents are).
 */
export interface LabSlotLedgerRecord {
  laboratoryId: Types.ObjectId;
  /** Calendar date the slot belongs to (UTC midnight of that date). */
  bookingDate: Date;
  /** Slot start in the laboratory's timezone, `HH:mm`. */
  timeSlot: string;
  /** Number of capacity-holding bookings in this slot. */
  taken: number;
  createdAt: Date;
  updatedAt: Date;
}

const labSlotLedgerSchema = new Schema<LabSlotLedgerRecord>(
  {
    laboratoryId: {
      type: Schema.Types.ObjectId,
      ref: "Laboratory",
      required: true,
    },
    bookingDate: {
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
labSlotLedgerSchema.index(
  { laboratoryId: 1, bookingDate: 1, timeSlot: 1 },
  { unique: true },
);

export type LabSlotLedgerDocument = HydratedDocument<LabSlotLedgerRecord>;

/** Registered through the `getModel` helper (HMR-idempotent). */
export const LabSlotLedger = getModel<LabSlotLedgerRecord>(
  "LabSlotLedger",
  labSlotLedgerSchema,
);
