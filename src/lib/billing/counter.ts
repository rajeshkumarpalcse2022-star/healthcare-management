import "server-only";

import {
  formatInvoiceCode,
  formatPaymentCode,
} from "@/config/billing";
import { Counter } from "@/models/Counter";

/**
 * Atomic invoice/payment reference generators (P1-2).
 *
 * Same Counter pattern as `nextBookingCode`: one named sequence per year
 * per series, bumped exclusively through `findOneAndUpdate` + `$inc` (atomic
 * per document in MongoDB, no transactions required). A duplicate-key race
 * on the very first insert of a year is retried. Numbers are never reused -
 * VOID invoices and refunded payments keep their reference forever.
 * Invoice and payment series are independent (`invoice:` vs `payment:`).
 */
async function nextSequence(prefix: string, now: Date): Promise<number> {
  const year = now.getUTCFullYear();
  const sequenceId = `${prefix}:${year}`;

  for (let attempt = 0; ; attempt += 1) {
    try {
      const doc = await Counter.findOneAndUpdate(
        { _id: sequenceId },
        { $inc: { seq: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      ).lean();

      const sequence = typeof doc?.seq === "number" ? doc.seq : 1;
      return sequence;
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

export async function nextInvoiceCode(now = new Date()): Promise<string> {
  const year = now.getUTCFullYear();
  return formatInvoiceCode(year, await nextSequence("invoice", now));
}

export async function nextPaymentCode(now = new Date()): Promise<string> {
  const year = now.getUTCFullYear();
  return formatPaymentCode(year, await nextSequence("payment", now));
}
