#!/usr/bin/env node
/**
 * DEVELOPMENT-ONLY demo account seed.
 *
 * Creates (or updates) the one-click demo accounts shown on the public login
 * page. Never runs automatically and performs no destructive operations -
 * each account is a targeted upsert by email.
 *
 * Usage:
 *   node scripts/seed-demo-users.mjs
 *
 * Reads MONGODB_URI from .env.local (falls back to the process environment).
 * Safe to re-run: it resets the demo password and role each time.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import bcrypt from "bcryptjs";
import mongoose from "mongoose";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");

const DEMO_PASSWORD = "Healthcare@123";

const DEMO_USERS = [
  { name: "Demo Admin", email: "admin@healthcare.test", role: "ADMIN" },
  { name: "Demo Doctor", email: "doctor@healthcare.test", role: "DOCTOR" },
  { name: "Demo Lab Manager", email: "lab@healthcare.test", role: "LAB_MANAGER" },
  { name: "Demo Patient", email: "patient@healthcare.test", role: "PATIENT" },
  { name: "Demo Collector", email: "collector@healthcare.test", role: "COLLECTOR" },
];

function loadEnvFile() {
  const envPath = path.join(projectRoot, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const contents = fs.readFileSync(envPath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    const value = rawValue.replace(/^["']|["']$/g, "");
    if (value.length > 0) process.env[key] = value;
  }
}

function fail(message) {
  console.error(`\n[seed-demo] ERROR: ${message}\n`);
  process.exit(1);
}

loadEnvFile();

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  fail("MONGODB_URI is not set (add it to .env.local - see .env.example).");
}

async function main() {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
  const now = new Date();
  const users = mongoose.connection.db.collection("users");

  for (const user of DEMO_USERS) {
    const result = await users.updateOne(
      { email: user.email },
      {
        $set: {
          name: user.name,
          email: user.email,
          phone: null,
          passwordHash,
          role: user.role,
          isActive: true,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
        // Demo lab managers review every request across the platform.
        ...(user.role === "LAB_MANAGER"
          ? { $unset: { laboratoryIds: "" } }
          : {}),
      },
      { upsert: true },
    );

    const outcome = result.upsertedCount > 0 ? "created" : "updated";
    console.log(`[seed-demo] ${outcome}: ${user.email} (${user.role})`);
  }

  console.log(`[seed-demo] Password for every demo account: ${DEMO_PASSWORD}`);
  console.log("[seed-demo] Done.\n");
}

main()
  .catch((error) => {
    console.error(
      "\n[seed-demo] ERROR:",
      error instanceof Error ? error.message : "unknown error",
      "\n",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
