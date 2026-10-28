import { Schema } from "mongoose";

import { getModel } from "@/lib/db";

/**
 * Counter model - atomic sequence generator shared by business-code formats.
 *
 * Each document is one named sequence (`_id`), incremented only through
 * `findOneAndUpdate` with `$inc`, which MongoDB executes atomically per
 * document. That makes it safe under concurrent requests without any
 * transaction support and - unlike `countDocuments()` - never yields
 * duplicate numbers. Sequences only increase: cancelled or deleted records
 * never release their number.
 */
export interface CounterRecord {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<CounterRecord>({
  // Sequence ids are named strings (`lab-booking:2026`), so the primary key
  // must be a String - mongoose's default ObjectId _id would CastError.
  _id: {
    type: String,
    required: true,
  },
  seq: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
});

/** `seq` is maintained exclusively through atomic `$inc` updates. */
counterSchema.index({ seq: 1 });

/** Registered through the `getModel` helper (HMR-idempotent). */
export const Counter = getModel<CounterRecord>("Counter", counterSchema);
