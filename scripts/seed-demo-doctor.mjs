#!/usr/bin/env node
/**
 * DEVELOPMENT-ONLY demo doctor seed.
 *
 * Creates (or updates) one demo clinic + one demo doctor with a published
 * scheduleConfig so the patient appointment flow can be exercised end to end
 * without manual setup. Never runs automatically.
 *
 * Usage:
 *   node scripts/seed-demo-doctor.mjs
 *
 * Reads MONGODB_URI from .env.local (falls back to the process environment).
 * Safe to re-run: upserts by code. Uses raw collection access so the seed
 * never depends on the app's Mongoose schema definitions.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import mongoose from "mongoose";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");

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
  console.error(`\n[seed-doctor] ERROR: ${message}\n`);
  process.exit(1);
}

loadEnvFile();

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  fail("MONGODB_URI is not set (add it to .env.local).");
}

/** Demo data - edit here to change the seeded doctor. */
const CLINIC = {
  name: "Carepoint Diagnostics & Clinic",
  code: "CAREPOINT",
  phone: "+91-98765-43210",
  email: "carepoint@example.test",
  address: "12, Greenway Road, Koramangala",
  city: "Bengaluru",
  state: "Karnataka",
  pincode: "560034",
  registrationNumber: "CLINIC-KA-2024-0001",
  isActive: true,
};

const DOCTOR = {
  doctorCode: "DR-SHAH",
  name: "Dr. Arjun Shah",
  email: "dr.arjun.shah@example.test",
  phone: "+91-98765-43210",
  specialization: "Cardiology",
  qualification: "MD, DM (Cardiology)",
  registrationNumber: "MCI-2015-44201",
  experienceYears: 12,
  consultationFee: 800,
  gender: "MALE",
  bio:
    "Dr. Arjun Shah is a board-certified cardiologist with over a decade of experience in preventive cardiology, echocardiography and non-invasive interventions.",
  isActive: true,
  scheduleConfig: {
    timezone: "Asia/Kolkata",
    operatingDays: [1, 2, 3, 4, 5], // Mon-Fri
    openingTime: "09:00",
    closingTime: "17:00",
    slotDurationMinutes: 30,
    maxAdvanceDays: 14,
    breaks: [{ start: "13:00", end: "14:00" }],
    unavailableDates: [],
  },
};

async function main() {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection.db;
  const now = new Date();

  /* ---------------- Clinic ---------------- */
  const clinicCol = db.collection("clinics");
  const clinicResult = await clinicCol.updateOne(
    { code: CLINIC.code.toUpperCase() },
    {
      $set: { ...CLINIC, code: CLINIC.code.toUpperCase(), updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
  const clinicId = (
    await clinicCol.findOne({ code: CLINIC.code.toUpperCase() })
  )._id;
  console.log(`[seed-doctor] Clinic ${clinicResult.upsertedCount > 0 ? "created" : "updated"}: ${CLINIC.name} (${clinicId})`);

  /* ---------------- Doctor ---------------- */
  const doctorCol = db.collection("doctors");
  const doctorResult = await doctorCol.updateOne(
    { doctorCode: DOCTOR.doctorCode.toUpperCase() },
    {
      $set: {
        ...DOCTOR,
        doctorCode: DOCTOR.doctorCode.toUpperCase(),
        clinicId,
        scheduleConfig: DOCTOR.scheduleConfig,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now },
    },
    { upsert: true },
  );
  const doctorId = (
    await doctorCol.findOne({ doctorCode: DOCTOR.doctorCode.toUpperCase() })
  )._id;
  console.log(`[seed-doctor] Doctor ${doctorResult.upsertedCount > 0 ? "created" : "updated"}: ${DOCTOR.name} (${doctorId})`);
  console.log(`[seed-doctor] Code: ${DOCTOR.doctorCode.toUpperCase()}`);
  console.log(`[seed-doctor] Schedule: Mon-Fri 09:00-17:00, 30-min slots, lunch 13:00-14:00`);
  console.log("[seed-doctor] Done.\n");
}

main()
  .catch((error) => {
    console.error("\n[seed-doctor] ERROR:", error instanceof Error ? error.message : "unknown error", "\n");
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });