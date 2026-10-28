#!/usr/bin/env node
/**
 * DEVELOPMENT-ONLY user seed.
 *
 * This script is completely separate from the application: it never runs
 * automatically, is not imported by any app code, and performs no destructive
 * operations (no drops, no deletes - only a single targeted upsert).
 *
 * It exists because Step 3 ships with no sign-up flow, so a developer needs a
 * way to create the first user in their OWN local database. Credentials are
 * always supplied on the command line - nothing fake is stored in the repo.
 *
 * Usage:
 *   node scripts/seed-dev-user.mjs <email> <password> [name] [role]
 *
 * Examples:
 *   node scripts/seed-dev-user.mjs admin@local.test 'choose-a-strong-pass' 'Local Admin' ADMIN
 *   node scripts/seed-dev-user.mjs doctor@local.test 'choose-a-strong-pass'
 *
 * Reads MONGODB_URI from .env.local (falls back to the process environment).
 * Passwords are hashed with bcrypt (cost 12) before storage and are never
 * echoed back.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import bcrypt from "bcryptjs";
import mongoose from "mongoose";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");

function fail(message) {
  console.error(`\n[seed] ERROR: ${message}\n`);
  process.exit(1);
}

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

/** Role list is parsed from the app's single source of truth. */
function loadRoles() {
  const rolesPath = path.join(projectRoot, "src", "config", "roles.ts");
  const source = fs.readFileSync(rolesPath, "utf8");
  const roles = [...source.matchAll(/([A-Z_]+):\s*"([A-Z_]+)"/g)].map(
    (match) => match[2],
  );
  if (roles.length === 0) {
    fail("Could not parse roles from src/config/roles.ts");
  }
  return roles;
}

const [, , emailArg, passwordArg, nameArg, roleArg] = process.argv;

if (!emailArg || !passwordArg) {
  console.error(
    "\nUsage: node scripts/seed-dev-user.mjs <email> <password> [name] [role]\n" +
      "  Development only. You must supply your own local credentials.\n",
  );
  process.exit(1);
}

const email = emailArg.trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  fail(`"${emailArg}" is not a valid email address.`);
}
if (passwordArg.length < 8) {
  fail("Password must be at least 8 characters.");
}

const roles = loadRoles();
const role = (roleArg || "STAFF").toUpperCase();
if (!roles.includes(role)) {
  fail(`Unknown role "${role}". Valid roles: ${roles.join(", ")}`);
}

const name = (nameArg || email.split("@")[0]).trim();
if (!name) fail("Name must not be empty.");

loadEnvFile();

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  fail("MONGODB_URI is not set (add it to .env.local - see .env.example).");
}

async function main() {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });

  const passwordHash = await bcrypt.hash(passwordArg, 12);
  const now = new Date();

  const collection = mongoose.connection.db.collection("users");
  const result = await collection.updateOne(
    { email },
    {
      $set: {
        name,
        email,
        phone: null,
        passwordHash,
        role,
        isActive: true,
        updatedAt: now,
      },
      $setOnInsert: {
        createdAt: now,
        // New LM/STAFF accounts start explicitly scoped to no laboratory
        // (assignments are granted later through the admin API). Insert-only
        // so re-running the seed never wipes existing assignments; roles
        // outside that pair keep no field at all (platform-wide).
        ...(role === "LAB_MANAGER" || role === "STAFF"
          ? { laboratoryIds: [] }
          : {}),
      },
    },
    { upsert: true },
  );

  const outcome = result.upsertedCount > 0 ? "created" : "updated";
  console.log(`\n[seed] User ${outcome}: ${email} (role: ${role})`);
  console.log("[seed] Password stored as a bcrypt hash. It is not printed.");
  console.log("[seed] Done.\n");
}

main()
  .catch((error) => {
    console.error(
      "\n[seed] ERROR:",
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
