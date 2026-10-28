import "server-only";

import type { ClientSession } from "mongoose";

import { connectToDatabase } from "@/lib/db/connection";

/**
 * Multi-document transaction helper with capability detection (P1-2/P1-3).
 *
 * The platform's MongoDB deployment may or may not be a replica set / mongos
 * (the transactions the driver needs are illegal on a standalone). Rather
 * than silently assuming, `runInTransaction` probes support once per process
 * and:
 *
 * - supported     -> runs the work inside `session.withTransaction` so
 *                    multi-collection writes commit or roll back together;
 * - unsupported   -> runs the work with `null` session (sequential writes).
 *                    Callers on this path MUST keep the compensating or
 *                    derived-state strategies documented on their routes
 *                    (billing balances recompute from the payments ledger;
 *                    inventory stock/history use the recovery scan).
 *
 * The probe result is cached per process; a deployment change is picked up
 * on restart. Probe failures are treated as "unsupported" (safe fallback),
 * never as a hard error - the fallback path is always correct, just not
 * atomic.
 */

let cachedSupport: boolean | null = null;

export async function transactionsSupported(): Promise<boolean> {
  if (cachedSupport !== null) return cachedSupport;

  const conn = await connectToDatabase();
  const session = await conn.connection.startSession();
  try {
    session.startTransaction();
    // Any real read inside the transaction exercises the "transaction
    // numbers" server-side check; standalone servers reject with code 20.
    await conn.connection.db!.collection("counters").findOne({}, { session });
    await session.commitTransaction();
    cachedSupport = true;
  } catch {
    try {
      if (session.inTransaction()) await session.abortTransaction();
    } catch {
      // abort of an already-failed transaction - safe to ignore
    }
    cachedSupport = false;
  } finally {
    await session.endSession();
  }
  return cachedSupport;
}

/**
 * Runs `work` inside a transaction when the deployment supports one, else
 * directly with a `null` session. The work callback receives the session to
 * pass into every model call that must participate (`Model.findOne().session(s)`
 * etc.).
 */
export async function runInTransaction<T>(
  work: (session: ClientSession | null) => Promise<T>,
): Promise<T> {
  if (!(await transactionsSupported())) {
    return work(null);
  }

  const conn = await connectToDatabase();
  const session = await conn.connection.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    if (result === undefined) {
      throw new Error("Transaction work produced no result.");
    }
    return result;
  } finally {
    await session.endSession();
  }
}

/** Test/reset hook for the process-level capability cache. */
export function resetTransactionSupportCache(): void {
  cachedSupport = null;
}

export type { ClientSession };
