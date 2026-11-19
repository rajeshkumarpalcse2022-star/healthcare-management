import "server-only";

import { formatDoctorCode } from "@/config/doctors";
import { Counter } from "@/models/Counter";

/**
 * Atomic doctor-code generator (`DR-0001`, `DR-0002`, ...).
 *
 * Same Counter pattern as the appointment / booking reference generators:
 * one shared named sequence bumped exclusively through `findOneAndUpdate` +
 * `$inc` (atomic per document in MongoDB, no transactions required). A
 * duplicate-key race on the very first insert is retried. Numbers are never
 * reused - deactivated or deleted doctors keep their code forever.
 */
export async function nextDoctorCode(): Promise<string> {
  const sequenceId = "doctor";

  for (let attempt = 0; ; attempt += 1) {
    try {
      const doc = await Counter.findOneAndUpdate(
        { _id: sequenceId },
        { $inc: { seq: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean();

      const sequence = typeof doc?.seq === "number" ? doc.seq : 1;
      return formatDoctorCode(sequence);
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
