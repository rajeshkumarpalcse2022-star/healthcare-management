import "server-only";

import mongoose from "mongoose";

import { environment } from "@/config/environment";

/**
 * MongoDB connection architecture.
 *
 * Next.js hot-reloads modules on every request in development, so a plain
 * `mongoose.connect` call would open a new connection each time and quickly
 * exhaust the pool. This module caches the connection (and the in-flight
 * promise) on `globalThis` so it survives reloads.
 *
 * No models are defined yet - only the connection layer.
 */

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

const globalWithMongoose = globalThis as typeof globalThis & {
  __mongooseCache?: MongooseCache;
};

const cache: MongooseCache = globalWithMongoose.__mongooseCache ?? {
  conn: null,
  promise: null,
};

globalWithMongoose.__mongooseCache = cache;

/**
 * Network-level failures that are safe to retry once (or twice). These happen
 * when MongoDB Atlas closes an idle pooled socket, when the machine's network
 * drops momentarily, or when the driver's topology is being rebuilt - the
 * connection itself is still usable after a fresh attempt.
 */
const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

const TRANSIENT_ERROR_PATTERNS = [
  /connection .* closed/i,
  /topology is closed/i,
  /server selection timed out/i,
  /connection reset/i,
  /socket hang up/i,
];

export function isTransientDatabaseError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const { name, code, message } = error as {
    name?: unknown;
    code?: unknown;
    message?: unknown;
  };

  if (name === "MongoNetworkError" || name === "MongoServerSelectionError") {
    return true;
  }

  if (typeof code === "string" && TRANSIENT_ERROR_CODES.has(code)) {
    return true;
  }

  return (
    typeof message === "string" &&
    TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(message))
  );
}

function isConnectionReady(conn: typeof mongoose): boolean {
  return conn.connection.readyState === 1;
}

/**
 * Drops the cached handle so the next `connectToDatabase()` call opens a fresh
 * connection. Called when a query fails with a transient network error - the
 * cached socket is dead even though mongoose may still report it as open.
 */
async function resetConnection(): Promise<void> {
  const conn = cache.conn;
  cache.conn = null;
  cache.promise = null;

  if (!conn) return;

  try {
    await conn.disconnect();
  } catch (error) {
    console.error(
      "[db] disconnect during reset failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}

/**
 * Opens (or reuses) the MongoDB connection.
 *
 * Concurrent callers share a single in-flight promise, so a burst of requests
 * during a cold start produces exactly one connection attempt. A failed
 * attempt clears the promise so the next request can retry. A cached handle
 * that is no longer connected is discarded instead of being returned.
 *
 * `maxIdleTimeMS` retires pooled sockets before Atlas closes them, which is
 * the usual source of "read ECONNRESET" errors after periods of inactivity.
 */
export async function connectToDatabase(): Promise<typeof mongoose> {
  if (cache.conn && isConnectionReady(cache.conn)) {
    return cache.conn;
  }

  if (cache.conn) {
    // The cached handle is no longer connected; a new connection attempt is
    // required, so the previously settled promise must not be reused.
    cache.conn = null;
    cache.promise = null;
  }

  if (!cache.promise) {
    cache.promise = mongoose.connect(environment.mongodb.uri, {
      bufferCommands: false,
      maxPoolSize: 10,
      maxIdleTimeMS: 60_000,
      serverSelectionTimeoutMS: 5000,
    });
  }

  try {
    cache.conn = await cache.promise;
  } catch (error) {
    cache.promise = null;
    cache.conn = null;
    console.error(
      "[db] connection failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    throw error;
  }

  return cache.conn;
}

/**
 * Runs a database operation with bounded retries for transient network
 * failures (idle socket closed, brief connectivity loss). Non-transient errors
 * - validation, duplicate keys, application failures - propagate immediately
 * so callers keep their existing semantics.
 */
export async function withDatabaseRetry<T>(
  operation: () => Promise<T>,
  attempts = 3,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await connectToDatabase();
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isTransientDatabaseError(error) || attempt === attempts) {
        throw error;
      }

      console.error(
        `[db] transient failure (attempt ${attempt}/${attempts}); reconnecting:`,
        error instanceof Error ? error.message : "unknown error",
      );
      await resetConnection();
    }
  }

  throw lastError;
}

/**
 * Round-trip check against the server. Distinguishes a live connection from a
 * cached handle whose underlying socket has since dropped.
 */
export async function pingDatabase(): Promise<void> {
  const conn = await connectToDatabase();
  const db = conn.connection.db;

  if (!db) {
    throw new Error("MongoDB connection is not initialised.");
  }

  await db.command({ ping: 1 });
}
