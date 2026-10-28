/**
 * STEP 7 live contract tests.
 *
 * Boots the real Next.js dev server against a throwaway MongoDB database
 * (same cluster as .env.local, isolated db name), seeds throwaway accounts,
 *  and exercises the online lab-booking API end to end: authentication,
 *  role policy, availability, atomic capacity, idempotency, booking codes,
 *  cancellation policy, status transitions and concurrency (slot races,
 *  parallel idempotency-key submission).
 *
 * Run: npm run test:step7:live
 * Nothing outside `hmp_step7_live_test` is ever touched; the database is
 * dropped and the server stopped when the run finishes.
 */

import { spawn, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const bcrypt = require("bcryptjs");
const mongooseModule = await import("mongoose");
const mongoose = mongooseModule.default;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 3111;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_DB = "hmp_step7_live_test";
const TZ = "Asia/Kolkata";
const PASSWORD = "Step7Live!2026";

/* ------------------------------------------------------------------ *
 * Harness
 * ------------------------------------------------------------------ */

let passed = 0;
const failures = [];

function t(label, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failures.push(label);
    console.error(`  FAIL ${label}${detail ? ` -> ${detail}` : ""}`);
  }
}

function expectStatus(label, res, expected) {
  t(
    label,
    res.status === expected,
    `expected ${expected}, got ${res.status}: ${JSON.stringify(res.json)?.slice(0, 300)}`,
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadEnvUri() {
  const env = readFileSync(path.join(ROOT, ".env.local"), "utf8");
  const match = /^MONGODB_URI=(.+)$/m.exec(env);
  if (!match) throw new Error("MONGODB_URI missing from .env.local");
  return match[1].trim();
}

function withDb(uri, dbName) {
  const url = new URL(uri);
  url.pathname = `/${dbName}`;
  return url.toString();
}

async function api(method, pathname, { cookie, body } = {}) {
  // The remote MongoDB's monitor links flake for ~10-15s at random points
  // mid-run (server log: "[auth] getCurrentUser failed: connection <monitor>
  // ... closed/timed out"). Genuine session problems must stay 401, but the
  // session-resolution DB-failure contract now answers a retryable 503.
  // Retry ONLY cookie-bearing 401/503 responses (anonymous requests and
  // every other status pass straight through) and still return the final
  // response, so every assertion keeps demanding its real outcome - a
  // genuine session defect fails through all retries and surfaces as such.
  let attempt = 0;
  while (true) {
    let response;
    try {
      response = await fetch(`${BASE}${pathname}`, {
        method,
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      return { status: 0, json: null, headers: new Headers(), error: String(error) };
    }
    attempt += 1;
    if ((response.status === 401 || response.status === 503) && cookie && attempt <= 4) {
      try {
        await response.body?.cancel();
      } catch {
        // body already unusable - safe to ignore before retrying
      }
      await sleep(4000);
      continue;
    }
    let json = null;
    try {
      json = await response.json();
    } catch {
      // non-JSON body (shouldn't happen for these routes)
    }
    return { status: response.status, json, headers: response.headers };
  }
}

async function login(email) {
  const res = await api("POST", "/api/auth/login", {
    body: { email, password: PASSWORD },
  });
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.json)}`);
  }
  const setCookie = res.headers.get("set-cookie") ?? "";
  return { cookie: setCookie.split(";")[0], user: res.json.user };
}

/* ---------------- date helpers (laboratory timezone) ---------------- */

function todayTz(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function minutesNowTz(now = new Date()) {
  const text = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
  const [hour, minute] = text.split(":").map(Number);
  return hour * 60 + minute;
}

function hhmm(minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ *
 * Database + server lifecycle
 * ------------------------------------------------------------------ */

const uri = withDb(loadEnvUri(), TEST_DB);
let server = null;

async function waitForServer(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await sleep(400);
  }
  throw new Error("dev server did not become ready in time");
}

function stopServer() {
  if (!server) return;
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: "ignore" });
    } else {
      server.kill("SIGTERM");
    }
  } catch {
    // already gone
  }
  server = null;
}

async function seedUsers() {
  const now = new Date();
  const passwordHash = bcrypt.hashSync(PASSWORD, 10);
  const users = [
    ["Step7 Super Admin", "step7.super@example.com", "SUPER_ADMIN"],
    ["Step7 Admin", "step7.admin@example.com", "ADMIN"],
    ["Step7 Lab Manager", "step7.labmanager@example.com", "LAB_MANAGER"],
    ["Step7 Staff", "step7.staff@example.com", "STAFF"],
    ["Step7 Patient One", "step7.patient1@example.com", "PATIENT"],
    ["Step7 Patient Two", "step7.patient2@example.com", "PATIENT"],
    ["Step7 Doctor", "step7.doctor@example.com", "DOCTOR"],
  ].map(([name, email, role], index) => ({
    name,
    email,
    phone: `+91 90000001${String(index).padStart(2, "0")}`,
    passwordHash,
    role,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }));

  await mongoose.connection.db.collection("users").insertMany(users);
  return Object.fromEntries(users.map((user) => [user.role, user.email]));
}

/* ------------------------------------------------------------------ *
 * Scenarios
 * ------------------------------------------------------------------ */

async function main() {
  console.log("STEP 7 live contract tests (throwaway db:", TEST_DB, ")");

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15_000 });
  console.log("  connected to throwaway database - dropping previous run");
  await mongoose.connection.dropDatabase();

  const emails = await seedUsers();

  server = spawn(
    process.execPath,
    [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "dev", "--port", String(PORT)],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        MONGODB_URI: uri,
        AUTH_SECRET: "step7-live-test-secret-not-a-real-deployment-key",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stdout.on("data", () => {});
  server.stderr.on("data", (chunk) => {
    const text = String(chunk);
    if (/error|exception/i.test(text)) process.stderr.write(`[next] ${text}`);
  });

  await waitForServer();

  const sessions = {};
  for (const [role, email] of Object.entries(emails)) {
    sessions[role] = await login(email);
  }

  const superAdmin = sessions.SUPER_ADMIN.cookie;
  const admin = sessions.ADMIN.cookie;
  const labManager = sessions.LAB_MANAGER.cookie;
  const staff = sessions.STAFF.cookie;
  const doctor = sessions.DOCTOR.cookie;
  const p1 = await login("step7.patient1@example.com");
  const p2 = await login("step7.patient2@example.com");
  const patient1Cookie = p1.cookie;
  const patient2Cookie = p2.cookie;
  const patient1Id = p1.user.id;
  const patient2Id = p2.user.id;

  console.log("\n[1] laboratory setup (booking configuration via API)");
  const labConfig = {
    timezone: TZ,
    operatingDays: [0, 1, 2, 3, 4, 5, 6],
    openingTime: "08:00",
    closingTime: "20:00",
    slotDurationMinutes: 30,
    slotCapacity: 1, // deliberately tight so capacity logic is observable
    maxAdvanceDays: 30,
  };
  const labRes = await api("POST", "/api/laboratories", {
    cookie: superAdmin,
    body: {
      name: "Step7 Live Lab",
      code: "S7-LIVE",
      city: "Pune",
      state: "Maharashtra",
      bookingConfig: labConfig,
    },
  });
  expectStatus("create laboratory with booking configuration -> 201", labRes, 201);
  const labId = labRes.json?.data?.id;
  t("laboratory id returned", typeof labId === "string" && labId.length > 0);
  t(
    "laboratory bookingConfig echoed with capacity 1",
    labRes.json?.data?.bookingConfig?.slotCapacity === 1,
    JSON.stringify(labRes.json?.data?.bookingConfig),
  );

  const lab2Res = await api("POST", "/api/laboratories", {
    cookie: superAdmin,
    body: { name: "Step7 Unconfigured Lab", code: "S7-NOBOOK" },
  });
  expectStatus("create laboratory without booking configuration -> 201", lab2Res, 201);
  const lab2Id = lab2Res.json?.data?.id;
  t(
    "unconfigured laboratory stores no bookingConfig",
    lab2Res.json?.data?.bookingConfig === null || lab2Res.json?.data?.bookingConfig === undefined,
    JSON.stringify(lab2Res.json?.data?.bookingConfig),
  );

  const deptRes = await api("POST", `/api/laboratories/${labId}/departments`, {
    cookie: superAdmin,
    body: { laboratoryId: labId, name: "Chemistry", code: "CHEM" },
  });
  expectStatus("create laboratory department -> 201", deptRes, 201);
  const deptId = deptRes.json?.data?.id;
  t("department id returned", typeof deptId === "string" && deptId.length > 0);

  const testRes = await api("POST", "/api/lab-tests", {
    cookie: superAdmin,
    body: {
      laboratoryId: labId,
      departmentId: deptId,
      name: "Blood Glucose Fasting",
      code: "GLU-F",
      category: "Biochemistry",
      specimenType: "Blood",
      turnaroundTimeMinutes: 60,
      price: 150,
    },
  });
  expectStatus("create bookable lab test -> 201", testRes, 201);
  const testId = testRes.json?.data?.id;
  t("lab test id returned", typeof testId === "string" && testId.length > 0);

  const dept2Res = await api("POST", `/api/laboratories/${lab2Id}/departments`, {
    cookie: superAdmin,
    body: { laboratoryId: lab2Id, name: "Pathology", code: "PATH" },
  });
  const test2Res = await api("POST", "/api/lab-tests", {
    cookie: superAdmin,
    body: {
      laboratoryId: lab2Id,
      departmentId: dept2Res.json?.data?.id,
      name: "Urine Routine",
      code: "UR-R",
      category: "Clinical Pathology",
      specimenType: "Urine",
      turnaroundTimeMinutes: 120,
      price: 90,
    },
  });
  const foreignTestId = test2Res.json?.data?.id;
  t("foreign-laboratory test seeded", typeof foreignTestId === "string");

  // Full-day laboratory: guarantees a slot inside the 2-hour cancellation
  // cutoff no matter what time of day the suite runs (except the last hour).
  const lab3Res = await api("POST", "/api/laboratories", {
    cookie: superAdmin,
    body: {
      name: "Step7 Cutoff Lab",
      code: "S7-CUT",
      bookingConfig: {
        timezone: TZ,
        operatingDays: [0, 1, 2, 3, 4, 5, 6],
        openingTime: "00:00",
        closingTime: "23:59",
        slotDurationMinutes: 30,
        slotCapacity: 1,
        maxAdvanceDays: 30,
      },
    },
  });
  expectStatus("create full-day laboratory -> 201", lab3Res, 201);
  const lab3Id = lab3Res.json?.data?.id;
  const dept3Res = await api("POST", `/api/laboratories/${lab3Id}/departments`, {
    cookie: superAdmin,
    body: { laboratoryId: lab3Id, name: "General", code: "GEN" },
  });
  const test3Res = await api("POST", "/api/lab-tests", {
    cookie: superAdmin,
    body: {
      laboratoryId: lab3Id,
      departmentId: dept3Res.json?.data?.id,
      name: "CBC Differential",
      code: "CBC-D",
      category: "Hematology",
      specimenType: "Whole Blood",
      turnaroundTimeMinutes: 90,
      price: 220,
    },
  });
  const cutoffTestId = test3Res.json?.data?.id;
  t("cutoff-laboratory test seeded", typeof cutoffTestId === "string");

  console.log("\n[2] catalogue (patient view)");
  const catalog = await api("GET", "/api/lab-bookings/catalog", { cookie: patient1Cookie });
  expectStatus("catalogue requires authentication context", catalog, 200);
  const labs = catalog.json?.data ?? [];
  t("configured laboratory is bookable", labs.some((entry) => entry.id === labId && entry.bookable === true));
  t(
    "unconfigured laboratory is explicitly not bookable",
    labs.some((entry) => entry.id === lab2Id && entry.bookable === false),
  );

  const testsRes = await api("GET", `/api/lab-bookings/catalog/tests?laboratoryId=${labId}`, {
    cookie: patient1Cookie,
  });
  expectStatus("bookable tests list -> 200", testsRes, 200);
  t(
    "bookable test exposes booking fields only",
    (testsRes.json?.data ?? []).some((entry) => entry.id === testId && entry.price === 150),
  );

  const noAuth = await api("GET", "/api/lab-bookings/catalog");
  expectStatus("catalogue without session -> 401", noAuth, 401);

  console.log("\n[3] verified availability");
  const today = todayTz();
  const tomorrow = addDays(today, 1);

  const avail = await api(
    "GET",
    `/api/lab-bookings/availability?laboratoryId=${labId}&date=${tomorrow}`,
    { cookie: patient1Cookie },
  );
  expectStatus("availability -> 200", avail, 200);
  const availData = avail.json?.data;
  t("availability is bookable", availData?.bookable === true);
  t("availability carries the schedule", availData?.schedule?.slotCapacity === 1);
  t("availability lists slots", (availData?.slots ?? []).length > 0);
  t("cancellation cutoff exposed", availData?.cancellationCutoffHours === 2);
  const firstSlot = availData?.slots?.[0]?.start;
  t("first slot is 08:00 (opening time)", firstSlot === "08:00", String(firstSlot));
  const secondSlot = availData?.slots?.[1]?.start;
  t("second slot is 08:30", secondSlot === "08:30", String(secondSlot));

  const availUnconfigured = await api(
    "GET",
    `/api/lab-bookings/availability?laboratoryId=${lab2Id}&date=${tomorrow}`,
    { cookie: patient1Cookie },
  );
  t(
    "unconfigured laboratory reports NOT_CONFIGURED",
    availUnconfigured.json?.data?.bookable === false &&
      availUnconfigured.json?.data?.unavailableReason === "NOT_CONFIGURED",
    JSON.stringify(availUnconfigured.json?.data),
  );

  const availPast = await api(
    "GET",
    `/api/lab-bookings/availability?laboratoryId=${labId}&date=${addDays(today, -3)}`,
    { cookie: patient1Cookie },
  );
  t(
    "past date reports DATE_OUT_OF_RANGE",
    availPast.json?.data?.unavailableReason === "DATE_OUT_OF_RANGE",
    JSON.stringify(availPast.json?.data),
  );

  const availFar = await api(
    "GET",
    `/api/lab-bookings/availability?laboratoryId=${labId}&date=${addDays(today, 45)}`,
    { cookie: patient1Cookie },
  );
  t(
    "beyond the advance window reports DATE_OUT_OF_RANGE",
    availFar.json?.data?.unavailableReason === "DATE_OUT_OF_RANGE",
    JSON.stringify(availFar.json?.data),
  );

  const availBad = await api(
    "GET",
    `/api/lab-bookings/availability?laboratoryId=${labId}&date=not-a-date`,
    { cookie: patient1Cookie },
  );
  expectStatus("availability with malformed date -> 400", availBad, 400);

  const availNoAuth = await api(
    "GET",
    `/api/lab-bookings/availability?laboratoryId=${labId}&date=${tomorrow}`,
  );
  expectStatus("availability without session -> 401", availNoAuth, 401);

  console.log("\n[4] booking creation, codes and idempotency");
  const year = new Date().getFullYear();
  const codePattern = new RegExp(`^LAB-${year}-\\d{6}$`);

  const b1 = await api("POST", "/api/lab-bookings", {
    cookie: patient1Cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      bookingDate: tomorrow,
      timeSlot: firstSlot,
      notes: "Fasting sample preferred.",
      contact: { phone: "+91 9000000911", email: null },
      idempotencyKey: "idem-live-b1-000001",
    },
  });
  expectStatus("patient creates booking -> 201", b1, 201);
  const b1Data = b1.json?.data;
  t("booking code matches LAB-YYYY-NNNNNN", codePattern.test(b1Data?.bookingCode ?? ""), b1Data?.bookingCode);
  t("initial status is PENDING", b1Data?.status === "PENDING");
  t("total amount comes from the catalogue", b1Data?.totalAmount === 150, String(b1Data?.totalAmount));
  t(
    "item snapshot carries name and price",
    b1Data?.items?.length === 1 && b1Data?.items[0].testName === "Blood Glucose Fasting" && b1Data?.items[0].price === 150,
    JSON.stringify(b1Data?.items),
  );
  t("contact snapshot recorded", b1Data?.contact?.phone === "+91 9000000911");
  t("booking belongs to the session patient", b1Data?.patient?.id === patient1Id, JSON.stringify(b1Data?.patient));
  t("booking stores the laboratory timezone", b1Data?.timezone === TZ);
  const b1Id = b1Data?.id;

  const b1Replay = await api("POST", "/api/lab-bookings", {
    cookie: patient1Cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      bookingDate: tomorrow,
      timeSlot: firstSlot,
      notes: "Fasting sample preferred.",
      contact: { phone: "+91 9000000911", email: null },
      idempotencyKey: "idem-live-b1-000001",
    },
  });
  expectStatus("idempotent replay -> 200 (original wins)", b1Replay, 200);
  t("idempotent replay returns the same booking", b1Replay.json?.data?.id === b1Id);

  const b1ReplayDifferent = await api("POST", "/api/lab-bookings", {
    cookie: patient1Cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId, testId].slice(0, 1),
      bookingDate: tomorrow,
      timeSlot: secondSlot,
      idempotencyKey: "idem-live-b1-000001",
    },
  });
  t(
    "same key with a different payload still returns the original booking",
    b1ReplayDifferent.json?.data?.id === b1Id && b1ReplayDifferent.json?.data?.timeSlot === firstSlot,
    JSON.stringify(b1ReplayDifferent.json?.data?.timeSlot),
  );

  const b2 = await api("POST", "/api/lab-bookings", {
    cookie: patient2Cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      bookingDate: tomorrow,
      timeSlot: secondSlot,
      idempotencyKey: "idem-live-b2-000002",
    },
  });
  expectStatus("second patient books another slot -> 201", b2, 201);
  const b2Data = b2.json?.data;
  t("booking codes are sequential and unique", b2Data?.bookingCode === `LAB-${year}-000002`, b2Data?.bookingCode);
  t("first code was the sequence start", b1Data?.bookingCode === `LAB-${year}-000001`, b1Data?.bookingCode);

  const capacityHit = await api("POST", "/api/lab-bookings", {
    cookie: patient2Cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      bookingDate: tomorrow,
      timeSlot: firstSlot, // capacity 1, already held by b1
      idempotencyKey: "idem-live-b2-capacity",
    },
  });
  expectStatus("full slot rejects with 409", capacityHit, 409);
  t(
    "capacity rejection explains the slot",
    /fully booked|capacity/i.test(capacityHit.json?.error ?? ""),
    capacityHit.json?.error,
  );

  const pastDate = await api("POST", "/api/lab-bookings", {
    cookie: patient1Cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      bookingDate: addDays(today, -1),
      timeSlot: firstSlot,
    },
  });
  expectStatus("past date rejected -> 409", pastDate, 409);

  const tooFar = await api("POST", "/api/lab-bookings", {
    cookie: patient1Cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      bookingDate: addDays(today, 45),
      timeSlot: firstSlot,
    },
  });
  expectStatus("beyond advance window rejected -> 409", tooFar, 409);

  const bogusSlot = await api("POST", "/api/lab-bookings", {
    cookie: patient1Cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      bookingDate: tomorrow,
      timeSlot: "12:17",
    },
  });
  expectStatus("slot outside the schedule rejected -> 409", bogusSlot, 409);

  const foreignTest = await api("POST", "/api/lab-bookings", {
    cookie: patient1Cookie,
    body: {
      laboratoryId: labId,
      testIds: [foreignTestId],
      bookingDate: tomorrow,
      timeSlot: "10:00",
    },
  });
  expectStatus("test from another laboratory rejected -> 409", foreignTest, 409);

  const unconfiguredBook = await api("POST", "/api/lab-bookings", {
    cookie: patient1Cookie,
    body: {
      laboratoryId: lab2Id,
      testIds: [foreignTestId],
      bookingDate: tomorrow,
      timeSlot: firstSlot,
    },
  });
  expectStatus("unconfigured laboratory rejects bookings -> 409", unconfiguredBook, 409);

  const doctorCreate = await api("POST", "/api/lab-bookings", {
    cookie: doctor,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      bookingDate: tomorrow,
      timeSlot: "11:00",
    },
  });
  expectStatus("doctor cannot create bookings -> 403", doctorCreate, 403);

  const crossPatient = await api("POST", "/api/lab-bookings", {
    cookie: patient1Cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      bookingDate: tomorrow,
      timeSlot: "11:00",
      patientUserId: patient2Id,
    },
  });
  expectStatus("patient cannot book for someone else -> 403", crossPatient, 403);

  const noSessionCreate = await api("POST", "/api/lab-bookings", {
    body: {
      laboratoryId: labId,
      testIds: [testId],
      bookingDate: tomorrow,
      timeSlot: "11:00",
    },
  });
  expectStatus("anonymous create -> 401", noSessionCreate, 401);

  console.log("\n[5] list scoping and search");
  const listP1 = await api("GET", "/api/lab-bookings?limit=50", { cookie: patient1Cookie });
  expectStatus("patient list -> 200", listP1, 200);
  t(
    "patient sees only their own bookings",
    (listP1.json?.data ?? []).every((row) => row.bookingCode !== b2Data.bookingCode) &&
      (listP1.json?.data ?? []).some((row) => row.id === b1Id),
    JSON.stringify(listP1.json?.data?.map((row) => row.bookingCode)),
  );

  const listAdmin = await api("GET", "/api/lab-bookings?limit=50", { cookie: admin });
  expectStatus("admin list -> 200", listAdmin, 200);
  t(
    "admin sees every booking",
    (listAdmin.json?.data ?? []).some((row) => row.id === b1Id) &&
      (listAdmin.json?.data ?? []).some((row) => row.id === b2Data.id),
  );
  t(
    "list rows carry no patient or contact details",
    (listAdmin.json?.data ?? []).every(
      (row) => row.patient === undefined && row.contact === undefined,
    ),
    JSON.stringify(Object.keys(listAdmin.json?.data?.[0] ?? {})),
  );

  const listStaff = await api("GET", "/api/lab-bookings", { cookie: staff });
  expectStatus("staff (management read role) -> 200", listStaff, 200);

  const listDoctor = await api("GET", "/api/lab-bookings", { cookie: doctor });
  expectStatus("doctor list -> 403", listDoctor, 403);

  const listAnon = await api("GET", "/api/lab-bookings");
  expectStatus("anonymous list -> 401", listAnon, 401);

  const listSearch = await api(
    "GET",
    `/api/lab-bookings?search=${b1Data.bookingCode}`,
    { cookie: admin },
  );
  t(
    "search by booking reference narrows to one row",
    (listSearch.json?.data ?? []).length === 1 &&
      listSearch.json.data[0].id === b1Id,
    JSON.stringify(listSearch.json?.data),
  );

  const listStatus = await api(
    "GET",
    `/api/lab-bookings?status=CONFIRMED&limit=50`,
    { cookie: admin },
  );
  t(
    "status filter returns only confirmed bookings",
    (listStatus.json?.data ?? []).every((row) => row.status === "CONFIRMED"),
  );

  const listLabFilter = await api(
    "GET",
    `/api/lab-bookings?laboratory=${lab2Id}&limit=50`,
    { cookie: admin },
  );
  t(
    "laboratory filter scopes correctly",
    (listLabFilter.json?.data ?? []).length === 0,
    JSON.stringify(listLabFilter.json?.data),
  );

  console.log("\n[6] authorised detail access");
  const detailOwner = await api("GET", `/api/lab-bookings/${b1Id}`, {
    cookie: patient1Cookie,
  });
  expectStatus("owner detail -> 200", detailOwner, 200);
  t(
    "detail includes items, contact and schedule",
    detailOwner.json?.data?.items?.length === 1 &&
      typeof detailOwner.json?.data?.bookingDate === "string" &&
      detailOwner.json?.data?.status === "PENDING",
    JSON.stringify(detailOwner.json?.data),
  );

  const detailAdmin = await api("GET", `/api/lab-bookings/${b1Id}`, { cookie: admin });
  expectStatus("admin detail -> 200", detailAdmin, 200);

  const detailOtherPatient = await api("GET", `/api/lab-bookings/${b1Id}`, {
    cookie: patient2Cookie,
  });
  expectStatus("another patient's detail -> 404 (no existence probing)", detailOtherPatient, 404);

  const detailDoctor = await api("GET", `/api/lab-bookings/${b1Id}`, { cookie: doctor });
  expectStatus("doctor detail -> 404", detailDoctor, 404);

  const detailAnon = await api("GET", `/api/lab-bookings/${b1Id}`);
  expectStatus("anonymous detail -> 401", detailAnon, 401);

  const detailBadId = await api("GET", "/api/lab-bookings/not-an-objectid", {
    cookie: admin,
  });
  expectStatus("malformed booking id -> 400", detailBadId, 400);

  console.log("\n[7] cancellation policy and capacity release");
  const cancelled = await api("PATCH", `/api/lab-bookings/${b1Id}/cancel`, {
    cookie: patient1Cookie,
    body: { reason: "Plans changed." },
  });
  expectStatus("owner cancels before the cutoff -> 200", cancelled, 200);
  t("status becomes CANCELLED", cancelled.json?.data?.status === "CANCELLED");
  t("cancellation reason recorded", cancelled.json?.data?.cancellationReason === "Plans changed.");
  t("cancellation timestamp recorded", typeof cancelled.json?.data?.cancelledAt === "string");

  const cancelAgain = await api("PATCH", `/api/lab-bookings/${b1Id}/cancel`, {
    cookie: admin,
    body: {},
  });
  expectStatus("double cancellation -> 409", cancelAgain, 409);

  const cancelledByDoctor = await api("PATCH", `/api/lab-bookings/${b1Id}/cancel`, {
    cookie: doctor,
    body: {},
  });
  expectStatus("doctor cancelling someone's booking -> 404", cancelledByDoctor, 404);

  const b3 = await api("POST", "/api/lab-bookings", {
    cookie: patient2Cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      bookingDate: tomorrow,
      timeSlot: firstSlot, // was full; released by the cancellation above
      idempotencyKey: "idem-live-b3-000003",
    },
  });
  expectStatus("released slot can be rebooked -> 201", b3, 201);
  const b3Data = b3.json?.data;
  t("booking code sequence continues", b3Data?.bookingCode === `LAB-${year}-000003`, b3Data?.bookingCode);

  const availAfter = await api(
    "GET",
    `/api/lab-bookings/availability?laboratoryId=${labId}&date=${tomorrow}`,
    { cookie: patient1Cookie },
  );
  const slotAfter = (availAfter.json?.data?.slots ?? []).find((entry) => entry.start === firstSlot);
  t(
    "availability shows the rebooked slot as full",
    slotAfter?.available === false && slotAfter?.remaining === 0,
    JSON.stringify(slotAfter),
  );
  const slotOther = (availAfter.json?.data?.slots ?? []).find((entry) => entry.start === "11:00");
  t("untouched slot still shows full capacity", slotOther?.remaining === 1, JSON.stringify(slotOther));

  /* -------- cancellation cutoff (same-day slot inside 2 hours) -------- */
  // The full-day laboratory guarantees a slot start in (now, now + 2h]
  // at almost any hour, so the cutoff rule is exercised deterministically.
  const nowMinutes = minutesNowTz();
  const cutoffStart = (() => {
    for (let start = 0; start + 30 <= 23 * 60 + 59; start += 30) {
      if (start > nowMinutes && start <= nowMinutes + 120) return start;
    }
    return null;
  })();
  if (cutoffStart !== null) {
    const withinCutoff = await api("POST", "/api/lab-bookings", {
      cookie: patient1Cookie,
      body: {
        laboratoryId: lab3Id,
        testIds: [cutoffTestId],
        bookingDate: today,
        timeSlot: hhmm(cutoffStart),
        idempotencyKey: "idem-live-cutoff",
      },
    });
    expectStatus(
      "same-day slot inside the cutoff window is bookable -> 201",
      withinCutoff,
      201,
    );
    if (withinCutoff.status === 201) {
      const lateCancel = await api(
        "PATCH",
        `/api/lab-bookings/${withinCutoff.json.data.id}/cancel`,
        { cookie: patient1Cookie, body: { reason: "too late" } },
      );
      expectStatus("cancellation inside the 2-hour cutoff -> 409", lateCancel, 409);
      t(
        "cutoff rejection explains the policy",
        /hour/i.test(lateCancel.json?.error ?? ""),
        lateCancel.json?.error,
      );
    }
  } else {
    console.log("  (skipped cutoff test - no slot inside the next 2 hours at this time of day)");
  }

  console.log("\n[8] operational status transitions");
  const confirm = await api("PATCH", `/api/lab-bookings/${b2Data.id}/status`, {
    cookie: admin,
    body: { status: "CONFIRMED" },
  });
  expectStatus("admin confirms PENDING booking -> 200", confirm, 200);
  t("status is CONFIRMED", confirm.json?.data?.status === "CONFIRMED");

  const confirmTwice = await api("PATCH", `/api/lab-bookings/${b2Data.id}/status`, {
    cookie: admin,
    body: { status: "CONFIRMED" },
  });
  expectStatus("re-confirming a confirmed booking -> 409", confirmTwice, 409);

  const complete = await api("PATCH", `/api/lab-bookings/${b2Data.id}/status`, {
    cookie: labManager,
    body: { status: "COMPLETED" },
  });
  expectStatus("lab manager completes CONFIRMED booking -> 200", complete, 200);
  t("status is COMPLETED", complete.json?.data?.status === "COMPLETED");

  const completeAgain = await api("PATCH", `/api/lab-bookings/${b2Data.id}/status`, {
    cookie: labManager,
    body: { status: "COMPLETED" },
  });
  expectStatus("completing twice -> 409", completeAgain, 409);

  const cancelCompleted = await api("PATCH", `/api/lab-bookings/${b2Data.id}/cancel`, {
    cookie: admin,
    body: {},
  });
  expectStatus("cancelling a completed booking -> 409", cancelCompleted, 409);

  const confirmPendingByPatient = await api(
    "PATCH",
    `/api/lab-bookings/${b3Data.id}/status`,
    { cookie: patient1Cookie, body: { status: "CONFIRMED" } },
  );
  expectStatus("patient cannot confirm -> 403", confirmPendingByPatient, 403);

  const confirmByStaff = await api("PATCH", `/api/lab-bookings/${b3Data.id}/status`, {
    cookie: staff,
    body: { status: "CONFIRMED" },
  });
  expectStatus("staff cannot confirm -> 403", confirmByStaff, 403);

  const illegalTarget = await api("PATCH", `/api/lab-bookings/${b3Data.id}/status`, {
    cookie: admin,
    body: { status: "PENDING" },
  });
  expectStatus("status endpoint rejects PENDING -> 400", illegalTarget, 400);

  const confirmByLabManager = await api(
    "PATCH",
    `/api/lab-bookings/${b3Data.id}/status`,
    { cookie: labManager, body: { status: "CONFIRMED" } },
  );
  expectStatus("lab manager confirms -> 200", confirmByLabManager, 200);

  const cancelConfirmed = await api(
    "PATCH",
    `/api/lab-bookings/${b3Data.id}/cancel`,
    { cookie: patient2Cookie, body: { reason: "Confirmed but no longer needed." } },
  );
  expectStatus("owner cancels their CONFIRMED booking -> 200", cancelConfirmed, 200);

  const statusOnCancelled = await api(
    "PATCH",
    `/api/lab-bookings/${b3Data.id}/status`,
    { cookie: admin, body: { status: "CONFIRMED" } },
  );
  expectStatus("cancelled booking cannot be reconfirmed -> 409", statusOnCancelled, 409);

  console.log("\n[9] booking on behalf of a patient (administrative roles)");
  const onBehalf = await api("POST", "/api/lab-bookings", {
    cookie: superAdmin,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      bookingDate: tomorrow,
      timeSlot: "12:00",
      patientUserId: patient1Id,
      idempotencyKey: "idem-live-onbehalf",
    },
  });
  expectStatus("super admin books for a patient -> 201", onBehalf, 201);
  t(
    "on-behalf booking resolves the patient account",
    onBehalf.json?.data?.patient?.id === patient1Id,
    JSON.stringify(onBehalf.json?.data?.patient),
  );
  const onBehalfSeq = Number(
    String(onBehalf.json?.data?.bookingCode ?? "").split("-")[2],
  );
  const b3Seq = Number(String(b3Data.bookingCode).split("-")[2]);
  t(
    "on-behalf booking continues the code sequence",
    codePattern.test(onBehalf.json?.data?.bookingCode ?? "") &&
      onBehalfSeq > b3Seq,
    onBehalf.json?.data?.bookingCode,
  );

  const onBehalfByLabManager = await api("POST", "/api/lab-bookings", {
    cookie: labManager,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      bookingDate: tomorrow,
      timeSlot: "12:30",
      patientUserId: patient1Id,
    },
  });
  expectStatus("lab manager cannot book for others -> 403", onBehalfByLabManager, 403);

  const onBehalfMissingPatient = await api("POST", "/api/lab-bookings", {
    cookie: admin,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      bookingDate: tomorrow,
      timeSlot: "13:00",
    },
  });
  expectStatus("on-behalf create without a patient -> 400", onBehalfMissingPatient, 400);

  /* -------- [9b] concurrency: slot races and parallel idempotency -------- */
  console.log("\n[9b] concurrency: slot races and parallel idempotency");

  const raceSlotS7 = "11:00"; // verified free with remaining=1 in [7]
  const raceSeatBodyA = {
    laboratoryId: labId,
    testIds: [testId],
    bookingDate: tomorrow,
    timeSlot: raceSlotS7,
    idempotencyKey: "idem-live-race-cap-000001",
  };
  const raceSeatBodyB = {
    laboratoryId: labId,
    testIds: [testId],
    bookingDate: tomorrow,
    timeSlot: raceSlotS7,
    idempotencyKey: "idem-live-race-cap-000002",
  };
  const [raceSeatA, raceSeatB] = await Promise.all([
    api("POST", "/api/lab-bookings", { cookie: patient1Cookie, body: raceSeatBodyA }),
    api("POST", "/api/lab-bookings", { cookie: patient2Cookie, body: raceSeatBodyB }),
  ]);
  const raceSeatStatuses = [raceSeatA.status, raceSeatB.status].sort((a, b) => a - b);
  t(
    "parallel bookings into the last seat yield 201 + 409",
    raceSeatStatuses[0] === 201 && raceSeatStatuses[1] === 409,
    JSON.stringify(raceSeatStatuses),
  );
  const raceSeatLoser =
    raceSeatA.status === 409 ? raceSeatA : raceSeatB.status === 409 ? raceSeatB : null;
  t(
    "the losing racer is told the slot is full",
    Boolean(raceSeatLoser) && /fully booked|capacity/i.test(raceSeatLoser.json?.error ?? ""),
    raceSeatLoser?.json?.error,
  );
  const raceSeatCountS7 = await mongoose.connection.db
    .collection("labbookings")
    .countDocuments({
      laboratoryId: new mongoose.Types.ObjectId(labId),
      bookingDate: new Date(`${tomorrow}T00:00:00.000Z`),
      timeSlot: raceSlotS7,
    });
  t("exactly one booking occupies the raced slot", raceSeatCountS7 === 1, String(raceSeatCountS7));

  const raceSameKeyS7 = "idem-live-race-samekey-000001";
  const raceSameBodyS7 = {
    laboratoryId: labId,
    testIds: [testId],
    bookingDate: tomorrow,
    timeSlot: "14:00", // untouched free slot, capacity 1
    idempotencyKey: raceSameKeyS7,
  };
  const [raceSameA, raceSameB] = await Promise.all([
    api("POST", "/api/lab-bookings", { cookie: patient1Cookie, body: raceSameBodyS7 }),
    api("POST", "/api/lab-bookings", { cookie: patient1Cookie, body: raceSameBodyS7 }),
  ]);
  const raceSameCreated = [raceSameA, raceSameB].filter((res) => res.status === 201);
  const raceSameOther = [raceSameA, raceSameB].filter((res) => res.status !== 201);
  t(
    "parallel same-key submission creates exactly one booking",
    raceSameCreated.length === 1,
    JSON.stringify([raceSameA.status, raceSameB.status]),
  );
  t(
    "the second racer never server-errors and answers replay or slot conflict",
    raceSameOther.length === 1 && [200, 409].includes(raceSameOther[0].status),
    String(raceSameOther[0]?.status),
  );
  if (raceSameOther[0]?.status === 200) {
    t(
      "the replayed racer returns the original booking",
      raceSameOther[0].json?.data?.id === raceSameCreated[0].json?.data?.id,
      JSON.stringify([
        raceSameOther[0].json?.data?.id,
        raceSameCreated[0].json?.data?.id,
      ]),
    );
  }
  const raceSameKeyCountS7 = await mongoose.connection.db
    .collection("labbookings")
    .countDocuments({ idempotencyKey: raceSameKeyS7 });
  t(
    "only one record exists for the raced idempotency key",
    raceSameKeyCountS7 === 1,
    String(raceSameKeyCountS7),
  );

  console.log("\n[10] removing the booking configuration via PATCH");
  const cleared = await api("PATCH", `/api/laboratories/${labId}`, {
    cookie: superAdmin,
    body: { bookingConfig: null },
  });
  expectStatus("PATCH bookingConfig null -> 200", cleared, 200);
  t(
    "booking configuration cleared",
    cleared.json?.data?.bookingConfig === null || cleared.json?.data?.bookingConfig === undefined,
    JSON.stringify(cleared.json?.data?.bookingConfig),
  );

  const availCleared = await api(
    "GET",
    `/api/lab-bookings/availability?laboratoryId=${labId}&date=${tomorrow}`,
    { cookie: patient1Cookie },
  );
  t(
    "cleared laboratory reports NOT_CONFIGURED",
    availCleared.json?.data?.unavailableReason === "NOT_CONFIGURED",
    JSON.stringify(availCleared.json?.data),
  );

  console.log("\n[11] page rendering (SSR smoke)");
  async function page(pathname, cookie) {
    // Same session-resolution blip as api(): during a database outage a
    // signed-in user's SSR page either redirects to login (3xx) or fails at
    // the root error boundary (500). Retry ONLY cookie-bearing redirects and
    // 500s (the anonymous redirect expectation passes through untouched)
    // and return the final response so each assertion keeps demanding its
    // real outcome.
    let attempt = 0;
    while (true) {
      let response;
      try {
        response = await fetch(`${BASE}${pathname}`, {
          redirect: "manual",
          headers: cookie ? { cookie } : {},
        });
      } catch (error) {
        return { status: 0, html: "", error: String(error) };
      }
      attempt += 1;
      if (
        cookie &&
        ((response.status >= 300 && response.status < 400) || response.status === 500) &&
        attempt <= 4
      ) {
        try {
          await response.body?.cancel();
        } catch {
          // body already unusable - safe to ignore before retrying
        }
        await sleep(4000);
        continue;
      }
      return { status: response.status, html: await response.text() };
    }
  }

  const bookingPage = await page("/bookings", patient1Cookie);
  t("patient booking flow page renders", bookingPage.status === 200, String(bookingPage.status));
  t(
    "booking flow shows the wizard",
    bookingPage.html.includes("Choose a laboratory") ||
      bookingPage.html.includes("Online booking"),
    `${bookingPage.status}`,
  );

  const myBookingsPage = await page("/my-bookings", patient1Cookie);
  t("my bookings page renders", myBookingsPage.status === 200, String(myBookingsPage.status));
  t("my bookings page shows the list heading", myBookingsPage.html.includes("My bookings"));

  const managePage = await page("/lab-bookings", admin);
  t("management list page renders", managePage.status === 200, String(managePage.status));
  t("management list heading present", managePage.html.includes("Lab bookings"));

  const detailPage = await page(`/lab-bookings/${b1Id}`, patient1Cookie);
  t("booking detail page renders", detailPage.status === 200, String(detailPage.status));
  t(
    "detail page shows the detail heading",
    detailPage.html.includes("Booking details"),
    String(detailPage.status),
  );

  const deniedPage = await page("/lab-bookings", doctor);
  t(
    "non-management role sees an explicit no-access state",
    deniedPage.status === 200 && deniedPage.html.includes("No access to booking management"),
    `${deniedPage.status}`,
  );

  const anonymousRedirect = await page("/bookings");
  t(
    "anonymous visitor is redirected to login",
    anonymousRedirect.status >= 300 && anonymousRedirect.status < 400,
    String(anonymousRedirect.status),
  );
}

/* ------------------------------------------------------------------ *
 * Teardown + report
 * ------------------------------------------------------------------ */

try {
  await main();
} catch (error) {
  console.error("FATAL:", error);
  failures.push(`fatal: ${error?.message ?? error}`);
} finally {
  stopServer();
  try {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log("\n  throwaway database dropped");
  } catch (error) {
    console.error("cleanup failed:", error?.message ?? error);
  }
}

const total = passed + failures.length;
if (failures.length > 0) {
  console.error(`\nSTEP 7 live contract tests: ${passed}/${total} passed`);
  for (const failure of failures) console.error(`  x ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`\nSTEP 7 live contract tests: ${passed}/${total} passed`);
}
