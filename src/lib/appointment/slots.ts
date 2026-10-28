import "server-only";

import { isDuplicateKeyError } from "@/lib/api/response";
import { AppointmentSlotLedger } from "@/models/AppointmentSlotLedger";

/**
 * Concurrency-safe appointment slot capacity claims.
 *
 * `claimAppointmentSlot` performs a single atomic `findOneAndUpdate` guarded
 * by `taken < capacity` with `upsert`. MongoDB applies that update atomically
 * per document, so concurrent requests serialise on the ledger document
 * instead of racing on a read-then-insert. When the slot is already full the
 * filter matches nothing and the upsert attempts an insert, which the unique
 * `{ doctorId, appointmentDate, timeSlot }` index rejects with E11000 - the
 * caller retries the filter a bounded number of times and then reports the
 * slot as unavailable. This works on standalone topologies as well as
 * replica sets: no transaction is required. Capacity is always
 * `APPOINTMENT_SLOT_CAPACITY` (1) for both appointment types.
 */

export interface AppointmentSlotKey {
  doctorId: string;
  /** `YYYY-MM-DD` in the doctor's timezone. */
  date: string;
  timeSlot: string;
}

const CLAIM_ATTEMPTS = 3;

function dateAtUtcMidnight(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/**
 * Attempts to reserve one unit of capacity in the slot.
 * Returns `true` when the claim succeeded, `false` when the slot is full.
 */
export async function claimAppointmentSlot(
  key: AppointmentSlotKey,
  capacity: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt += 1) {
    try {
      await AppointmentSlotLedger.findOneAndUpdate(
        {
          doctorId: key.doctorId,
          appointmentDate: dateAtUtcMidnight(key.date),
          timeSlot: key.timeSlot,
          taken: { $lt: capacity },
        },
        { $inc: { taken: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      return true;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      // Lost the first-insert race or the slot filled between attempts:
      // loop to re-evaluate the guarded filter against the existing doc.
    }
  }
  return false;
}

/**
 * Releases one unit of capacity (appointment cancelled, rejected,
 * rescheduled away, or failed to persist).
 * Floored at zero so a double release can never produce negative counts.
 */
export async function releaseAppointmentSlot(
  key: AppointmentSlotKey,
): Promise<void> {
  await AppointmentSlotLedger.updateOne(
    {
      doctorId: key.doctorId,
      appointmentDate: dateAtUtcMidnight(key.date),
      timeSlot: key.timeSlot,
      taken: { $gt: 0 },
    },
    { $inc: { taken: -1 } },
  );
}

/**
 * Fire-and-forget release for cleanup paths: logs failures instead of
 * throwing so an error during rollback cannot mask the original failure or
 * turn a successful cancel into a 5xx. Over-counting capacity is the
 * conservative direction - it never allows overbooking.
 */
export async function releaseAppointmentSlotQuietly(
  key: AppointmentSlotKey,
): Promise<void> {
  try {
    await releaseAppointmentSlot(key);
  } catch (error) {
    console.error(
      "[appointment] slot release failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

/** Current occupancy per slot for one doctor date. */
export async function getAppointmentSlotOccupancy(
  doctorId: string,
  date: string,
): Promise<Map<string, number>> {
  const rows = await AppointmentSlotLedger.find({
    doctorId,
    appointmentDate: dateAtUtcMidnight(date),
  })
    .select("timeSlot taken")
    .lean();

  const occupancy = new Map<string, number>();
  for (const row of rows) {
    occupancy.set(row.timeSlot, row.taken);
  }
  return occupancy;
}
