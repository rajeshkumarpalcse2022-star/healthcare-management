import "server-only";

import { formatBookingCode } from "@/config/lab-bookings";
import { Counter } from "@/models/Counter";

/**
 * Atomic booking-reference generator.
 *
 * Each year has its own named sequence in the Counter collection, bumped
 * exclusively through `findOneAndUpdate` + `$inc` (atomic per document in
 * MongoDB, no transactions required). A duplicate-key race on the very first
 * insert of a year is retried once. Numbers are never reused - cancelled or
 * deleted bookings keep their reference forever.
 */
export async function nextBookingCode(now = new Date()): Promise<string> {
  const year = now.getUTCFullYear();
  const sequenceId = `lab-booking:${year}`;

  for (let attempt = 0; ; attempt += 1) {
    try {
      const doc = await Counter.findOneAndUpdate(
        { _id: sequenceId },
        { $inc: { seq: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean();

      const sequence = typeof doc?.seq === "number" ? doc.seq : 1;
      return formatBookingCode(year, sequence);
    } catch (error) {
      const duplicate =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: unknown }).code === 11000;
      if (duplicate && attempt < 2) continue;
      throw error;
    }
  }
}
