/**
 * Backfill unique account IDs for existing users.
 *
 * Every PATIENT / DOCTOR / LAB_MANAGER account that is missing a `uniqueId`
 * receives one (`PAT-XXXXX` / `DOC-XXXXX` / `LAB-XXXXX`). Accounts that
 * already have an ID are skipped. Passwords, emails and roles are untouched -
 * existing login credentials keep working exactly as before.
 *
 * Usage:
 *   node scripts/backfill-unique-ids.mjs
 *
 * Requires MONGODB_URI in the environment (or a .env.local loaded by the
 * runner). Safe to re-run: already-backfilled accounts are skipped.
 */

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Minimal .env.local loader so the script works without a process manager.
try {
  const envPath = join(__dirname, "..", ".env.local");
  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
} catch {
  // .env.local optional - rely on real environment variables.
}

const { mongoose } = await import("mongoose");

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PREFIXES = {
  PATIENT: "PAT",
  DOCTOR: "DOC",
  LAB_MANAGER: "LAB",
};

function randomBody(length = 5) {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

function generateUniqueId(role) {
  const prefix = PREFIXES[role];
  if (!prefix) return null;
  return `${prefix}-${randomBody()}`;
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set - configure .env.local first.");
    process.exit(1);
  }

  await mongoose.connect(uri);
  console.log("Connected to MongoDB.");

  const db = mongoose.connection.db;
  const users = db.collection("users");

  const roles = Object.keys(PREFIXES);
  let totalBackfilled = 0;

  for (const role of roles) {
    const cursor = users.find({
      role,
      $or: [{ uniqueId: { $exists: false } }, { uniqueId: null }, { uniqueId: "" }],
    });

    let count = 0;
    while (await cursor.hasNext()) {
      const doc = await cursor.next();

      // Allocate a free ID (retry on the unlikely collision).
      let uniqueId = generateUniqueId(role);
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const taken = await users.findOne({ uniqueId }, { projection: { _id: 1 } });
        if (!taken) break;
        uniqueId = generateUniqueId(role);
      }

      await users.updateOne({ _id: doc._id }, { $set: { uniqueId } });
      console.log(`  ${role}: ${doc.email} -> ${uniqueId}`);
      count += 1;
    }

    console.log(`${role}: backfilled ${count} account(s).`);
    totalBackfilled += count;
  }

  console.log(`Done. Total backfilled: ${totalBackfilled}.`);
  await mongoose.disconnect();
}

main().catch((error) => {
  console.error("Backfill failed:", error);
  process.exit(1);
});
