import "server-only";

import { formatCollectionCode } from "@/config/home-collection";
import { Counter } from "@/models/Counter";

/**
 * Atomic collection-reference generator (STEP 8).
 *
 * Each year has its own named sequence in the shared Counter collection,
 * bumped exclusively through `findOneAndUpdate` + `$inc` (atomic per document
 * in MongoDB, no transactions required). A duplicate-key race on the very
 * first insert of a year is retried once. Numbers are never reused -
 * cancelled or deleted collections keep their reference forever.
 */
export async function nextCollectionCode(now = new Date()): Promise<string> {
  const year = now.getUTCFullYear();
  const sequenceId = `home-collection:${year}`;

  for (let attempt = 0; ; attempt += 1) {
    try {
      const doc = await Counter.findOneAndUpdate(
        { _id: sequenceId },
        { $inc: { seq: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean();

      const sequence = typeof doc?.seq === "number" ? doc.seq : 1;
      return formatCollectionCode(year, sequence);
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
