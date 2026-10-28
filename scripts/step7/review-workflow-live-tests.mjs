/**
 * Central Collection Requests review-workflow live tests.
 *
 * Boots the real Next.js dev server against a throwaway MongoDB database
 * (same cluster as .env.local, isolated db name), seeds throwaway accounts,
 * and exercises the review queue end to end:
 *
 *  - queue gating (patients / doctors cannot reach it, operational roles can);
 *  - lab-visit approval (reviewer stamp, audit events, no duplicate records);
 *  - lab-visit rejection (mandatory reason, slot release, terminal state);
 *  - home-collection approval and rejection through the same queue;
 *  - the merged queue's filters, totals and per-type labelling;
 *  - the Online Booking management pseudo-filter (`status=REVIEWED`);
 *  - pickup OTP lifecycle end to end (expiry, attempt lock, cooldown,
 *    patient regeneration, concurrent single-winner completion);
 *  - the security matrix (anonymous / cross-user / cross-collector),
 *    idempotent replay, concurrent duplicate submission, slot capacity
 *    holds and cancellation release;
 *  - laboratory scope semantics: platform-wide management default and the
 *    `laboratory` filter;
 *  - per-laboratory scope assignment: the SA/ADMIN assignment API
 *    (round-trip, audit history, validation, authorisation) and the
 *    resulting scoped visibility for queue, directory and catalogue;
 *  - doctor/clinic + LIMS CRUD and role matrix (clinics, doctors,
 *    department/test status toggles, parameter lifecycle with renumbering);
 *  - staff account provisioning (SA/ADMIN create/edit APIs, role allow-list,
 *    fail-closed scope, self-mutation and privilege-escalation guards,
 *    /staff page SSR gate);
 *  - dashboard data-source queries against exact stored counts.
 *
 * Run: npm run test:review:live
 * Nothing outside `hmp_review_workflow_live_test` is ever touched; the
 * database is dropped and the server stopped when the run finishes.
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
const PORT = 3112;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_DB = "hmp_review_workflow_live_test";
const TZ = "Asia/Kolkata";
const PASSWORD = "ReviewLive!2026";

/* ------------------------------------------------------------------ *
 * Harness (mirrors live-contract-tests.mjs)
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
      // non-JSON body
    }
    return { status: response.status, json, headers: response.headers };
  }
}

async function loginWithPassword(email, password) {
  // The remote MongoDB's monitor links also flake on the server's very first
  // session-resolution after boot (no cookie exists yet, so api()'s
  // cookie-bearing retry cannot apply). Retry only 503s; a genuine bad
  // password still fails immediately as 401.
  let res;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    res = await api("POST", "/api/auth/login", {
      body: { email, password },
    });
    if (res.status !== 503) break;
    await sleep(4000);
  }
  if (res.status !== 200) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.json)}`);
  }
  const setCookie = res.headers.get("set-cookie") ?? "";
  return { cookie: setCookie.split(";")[0], user: res.json.user };
}

async function login(email) {
  return loginWithPassword(email, PASSWORD);
}

/** Fetches an SSR page as raw HTML (navigation smoke checks). */
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

/* ---------------- database + server lifecycle ---------------- */

const uri = withDb(loadEnvUri(), TEST_DB);
let server = null;
const serverLog = [];

async function waitForServer(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server && server.exitCode !== null) {
      throw new Error(
        `dev server exited with code ${server.exitCode} before becoming ready; output:\n${serverLog.join("")}`,
      );
    }
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await sleep(400);
  }
  throw new Error(`dev server did not become ready in time; output:\n${serverLog.join("")}`);
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
    ["Review Super Admin", "review.super@example.com", "SUPER_ADMIN"],
    ["Review Lab Manager", "review.labmanager@example.com", "LAB_MANAGER"],
    ["Review Staff", "review.staff@example.com", "STAFF"],
    ["Review Doctor", "review.doctor@example.com", "DOCTOR"],
    ["Review Patient One", "review.patient1@example.com", "PATIENT"],
    ["Review Patient Two", "review.patient2@example.com", "PATIENT"],
    ["Review Collector One", "review.collector1@example.com", "COLLECTOR"],
    ["Review Collector Two", "review.collector2@example.com", "COLLECTOR"],
  ].map(([name, email, role], index) => ({
    name,
    email,
    phone: `+91 91000001${String(index).padStart(2, "0")}`,
    passwordHash,
    role,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }));

  await mongoose.connection.db.collection("users").insertMany(users);
  return Object.fromEntries(users.map((user) => [user.role, user.email]));
}

async function countDocs(collection) {
  return mongoose.connection.db.collection(collection).countDocuments();
}

/* ------------------------------------------------------------------ *
 * Scenarios
 * ------------------------------------------------------------------ */

async function main() {
  console.log("Review-workflow live contract tests (throwaway db:", TEST_DB, ")");

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
        AUTH_SECRET: "review-workflow-live-test-secret",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
server.stdout.on("data", (chunk) => serverLog.push(String(chunk)));
server.stderr.on("data", (chunk) => {
  const text = String(chunk);
  serverLog.push(text);
  if (/error|exception|already running/i.test(text)) process.stderr.write(`[next] ${text}`);
});

await waitForServer();

  const sessions = {};
  for (const [role, email] of Object.entries(emails)) {
    sessions[role] = await login(email);
  }
  const superAdmin = sessions.SUPER_ADMIN.cookie;
  const labManager = sessions.LAB_MANAGER.cookie;
  const staff = sessions.STAFF.cookie;
  const doctor = sessions.DOCTOR.cookie;
  const p1 = await login("review.patient1@example.com");
  const p2 = await login("review.patient2@example.com");
  const collector1 = await login("review.collector1@example.com");
  const collector2 = await login("review.collector2@example.com");
  const patient1Cookie = p1.cookie;
  const patient2Cookie = p2.cookie;
  const patient1Name = p1.user.name;

  /* ---------------- [1] fixture laboratory ---------------- */
  console.log("\n[1] fixture setup");
  const tomorrow = addDays(todayTz(), 1);

  const labRes = await api("POST", "/api/laboratories", {
    cookie: superAdmin,
    body: {
      name: "Review Workflow Lab",
      code: "RW-LIVE",
      city: "Pune",
      state: "Maharashtra",
      bookingConfig: {
        timezone: TZ,
        operatingDays: [0, 1, 2, 3, 4, 5, 6],
        openingTime: "08:00",
        closingTime: "20:00",
        slotDurationMinutes: 30,
        slotCapacity: 2,
        maxAdvanceDays: 30,
      },
      homeCollectionConfig: {
        timezone: TZ,
        operatingDays: [0, 1, 2, 3, 4, 5, 6],
        openingTime: "08:00",
        closingTime: "14:00",
        slotDurationMinutes: 60,
        slotCapacity: 4,
        maxAdvanceDays: 14,
      },
    },
  });
  expectStatus("create laboratory with both configurations -> 201", labRes, 201);
  const labId = labRes.json?.data?.id;
  t("laboratory id returned", typeof labId === "string" && labId.length > 0);

  const deptRes = await api("POST", `/api/laboratories/${labId}/departments`, {
    cookie: superAdmin,
    body: { laboratoryId: labId, name: "Chemistry", code: "RW-CHEM" },
  });
  expectStatus("create department -> 201", deptRes, 201);

  const testRes = await api("POST", "/api/lab-tests", {
    cookie: superAdmin,
    body: {
      laboratoryId: labId,
      departmentId: deptRes.json?.data?.id,
      name: "Review Lipid Panel",
      code: "RW-LIPID",
      category: "Biochemistry",
      specimenType: "Blood",
      turnaroundTimeMinutes: 90,
      price: 450,
      labVisitEnabled: true,
      homeCollectionEnabled: true,
    },
  });
  expectStatus("create test enabled for both channels -> 201", testRes, 201);
  const testId = testRes.json?.data?.id;

  /* ---------------- [2] queue gating ---------------- */
  console.log("\n[2] collection requests queue gating");
  const queueNoAuth = await api("GET", "/api/collection-requests");
  expectStatus("queue without session -> 401", queueNoAuth, 401);

  const queuePatient = await api("GET", "/api/collection-requests", {
    cookie: patient1Cookie,
  });
  expectStatus("patient cannot reach the queue -> 403", queuePatient, 403);

  const queueDoctor = await api("GET", "/api/collection-requests", {
    cookie: doctor,
  });
  expectStatus("doctor cannot reach the queue -> 403", queueDoctor, 403);

  const queueEmpty = await api("GET", "/api/collection-requests", {
    cookie: labManager,
  });
  expectStatus("lab manager reaches the empty queue -> 200", queueEmpty, 200);
  t("empty queue reports zero rows", queueEmpty.json?.meta?.total === 0);

  const queueStaff = await api("GET", "/api/collection-requests", {
    cookie: staff,
  });
  expectStatus("staff reaches the queue -> 200", queueStaff, 200);

  /* ---------------- [3] lab-visit approval ---------------- */
  console.log("\n[3] lab-visit approval through the queue");
  const avail = await api(
    "GET",
    `/api/lab-bookings/availability?laboratoryId=${labId}&date=${tomorrow}`,
    { cookie: patient1Cookie },
  );
  expectStatus("booking availability -> 200", avail, 200);
  const firstSlot = avail.json?.data?.slots?.[0]?.start;
  const secondSlot = avail.json?.data?.slots?.[1]?.start;
  t("first slot resolved", typeof firstSlot === "string", String(firstSlot));

  const booking1 = await api("POST", "/api/lab-bookings", {
    cookie: patient1Cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      bookingDate: tomorrow,
      timeSlot: firstSlot,
      contact: { phone: "+91 9100000911", email: null },
      idempotencyKey: "idem-review-b1-000001",
    },
  });
  expectStatus("patient1 creates a lab-visit booking -> 201", booking1, 201);
  const booking1Data = booking1.json?.data;
  const booking1Id = booking1Data?.id;
  t("booking starts PENDING", booking1Data?.status === "PENDING");

  const queueAfterBooking = await api(
    "GET",
    "/api/collection-requests?status=PENDING",
    { cookie: labManager },
  );
  expectStatus("queue with a pending request -> 200", queueAfterBooking, 200);
  const queueRows = queueAfterBooking.json?.data ?? [];
  t("queue lists exactly one pending row", queueRows.length === 1, String(queueRows.length));
  const queueRow = queueRows[0];
  t(
    "queue row is typed LAB_VISIT",
    queueRow?.requestType === "LAB_VISIT",
    JSON.stringify(queueRow?.requestType),
  );
  t(
    "queue row carries the booking reference",
    queueRow?.reference === booking1Data?.bookingCode,
    String(queueRow?.reference),
  );
  t(
    "queue row carries the patient name",
    queueRow?.patientName === patient1Name,
    String(queueRow?.patientName),
  );
  t(
    "queue row carries the schedule",
    queueRow?.scheduledDate === tomorrow && queueRow?.timeSlot === firstSlot,
    JSON.stringify([queueRow?.scheduledDate, queueRow?.timeSlot]),
  );
  t(
    "queue row exposes no contact details",
    queueRow?.contact === undefined && queueRow?.address === undefined,
    JSON.stringify(Object.keys(queueRow ?? {})),
  );

  const pendingBookings = await api("GET", "/api/lab-bookings?status=PENDING", {
    cookie: labManager,
  });
  expectStatus("management list shows the pending booking -> 200", pendingBookings, 200);
  t(
    "pending booking is visible with status=PENDING",
    (pendingBookings.json?.data ?? []).some((row) => row.id === booking1Id),
  );
  const reviewedBefore = await api("GET", "/api/lab-bookings?status=REVIEWED", {
    cookie: labManager,
  });
  expectStatus("management REVIEWED list before approval -> 200", reviewedBefore, 200);
  t(
    "pending booking is absent from REVIEWED",
    !(reviewedBefore.json?.data ?? []).some((row) => row.id === booking1Id),
  );

  const approve1 = await api("PATCH", `/api/lab-bookings/${booking1Id}/status`, {
    cookie: labManager,
    body: { status: "CONFIRMED" },
  });
  expectStatus("lab manager approves the request -> 200", approve1, 200);
  const approved = approve1.json?.data;
  t("approval moves the booking to CONFIRMED", approved?.status === "CONFIRMED");
  t(
    "approval stamps the reviewer",
    typeof approved?.reviewedBy?.name === "string" &&
      approved.reviewedBy.name === sessions.LAB_MANAGER.user.name,
    JSON.stringify(approved?.reviewedBy),
  );
  t("approval stamps a review timestamp", typeof approved?.reviewedAt === "string");

  const queueAfterApprove = await api("GET", "/api/collection-requests", {
    cookie: labManager,
  });
  expectStatus("queue after approval -> 200", queueAfterApprove, 200);
  const approvedRow = (queueAfterApprove.json?.data ?? []).find(
    (row) => row.id === booking1Id,
  );
  t("approved request still appears in the queue", Boolean(approvedRow));
  t(
    "queue row now shows CONFIRMED",
    approvedRow?.status === "CONFIRMED",
    String(approvedRow?.status),
  );
  t(
    "queue row carries the review timestamp",
    typeof approvedRow?.reviewedAt === "string",
  );
  t(
    "queue total did not grow (no duplicated records)",
    queueAfterApprove.json?.meta?.total === 1,
    String(queueAfterApprove.json?.meta?.total),
  );

  const reviewedAfter = await api("GET", "/api/lab-bookings?status=REVIEWED", {
    cookie: labManager,
  });
  expectStatus("management REVIEWED list after approval -> 200", reviewedAfter, 200);
  t(
    "approved booking moved into REVIEWED",
    (reviewedAfter.json?.data ?? []).some((row) => row.id === booking1Id),
  );

  const approveAgain = await api("PATCH", `/api/lab-bookings/${booking1Id}/status`, {
    cookie: labManager,
    body: { status: "CONFIRMED" },
  });
  expectStatus("duplicate approval -> 409", approveAgain, 409);

  const detailOwner = await api("GET", `/api/lab-bookings/${booking1Id}`, {
    cookie: patient1Cookie,
  });
  expectStatus("owner reads the approved booking -> 200", detailOwner, 200);
  const detail = detailOwner.json?.data;
  t(
    "detail history includes the creation event",
    (detail?.history ?? []).some((entry) => entry.eventType === "REQUEST_CREATED"),
    JSON.stringify((detail?.history ?? []).map((entry) => entry.eventType)),
  );
  t(
    "detail history includes the approval event",
    (detail?.history ?? []).some((entry) => entry.eventType === "REQUEST_CONFIRMED"),
  );
  t(
    "approval event names the lab manager",
    (detail?.history ?? []).find((entry) => entry.eventType === "REQUEST_CONFIRMED")
      ?.actor?.name === sessions.LAB_MANAGER.user.name,
  );
  t(
    "detail resolves specimen requirements for the booked test",
    detail?.items?.[0]?.specimenType === "Blood",
    JSON.stringify(detail?.items?.[0]),
  );

  /* ---------------- [4] lab-visit rejection ---------------- */
  console.log("\n[4] lab-visit rejection through the queue");
  const booking2 = await api("POST", "/api/lab-bookings", {
    cookie: patient2Cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      bookingDate: tomorrow,
      timeSlot: secondSlot,
      idempotencyKey: "idem-review-b2-000002",
    },
  });
  expectStatus("patient2 creates a second booking -> 201", booking2, 201);
  const booking2Id = booking2.json?.data?.id;
  const booking2Code = booking2.json?.data?.bookingCode;

  const rejectNoReason = await api(`PATCH`, `/api/lab-bookings/${booking2Id}/reject`, {
    cookie: labManager,
    body: {},
  });
  expectStatus("reject without a reason -> 400", rejectNoReason, 400);

  const rejectShort = await api(`PATCH`, `/api/lab-bookings/${booking2Id}/reject`, {
    cookie: labManager,
    body: { reason: "no" },
  });
  expectStatus("reject with a too-short reason -> 400", rejectShort, 400);

  const reject1 = await api(`PATCH`, `/api/lab-bookings/${booking2Id}/reject`, {
    cookie: labManager,
    body: { reason: "The laboratory cannot run this panel on the requested day." },
  });
  expectStatus("lab manager rejects with a reason -> 200", reject1, 200);
  const rejected = reject1.json?.data;
  t("rejection moves the booking to REJECTED", rejected?.status === "REJECTED");
  t(
    "rejection stores the reason",
    typeof rejected?.rejectionReason === "string" &&
      rejected.rejectionReason.includes("cannot run this panel"),
    String(rejected?.rejectionReason),
  );
  t("rejection stamps the reviewer", typeof rejected?.reviewedBy?.name === "string");

  const rejectedList = await api("GET", "/api/collection-requests?status=REJECTED", {
    cookie: labManager,
  });
  expectStatus("queue filtered to REJECTED -> 200", rejectedList, 200);
  const rejectedRow = (rejectedList.json?.data ?? []).find(
    (row) => row.id === booking2Id,
  );
  t("rejected request appears in the queue", Boolean(rejectedRow));
  t(
    "rejected queue row keeps the LAB_VISIT type",
    rejectedRow?.requestType === "LAB_VISIT",
  );

  const approveRejected = await api("PATCH", `/api/lab-bookings/${booking2Id}/status`, {
    cookie: labManager,
    body: { status: "CONFIRMED" },
  });
  expectStatus("a rejected request cannot be approved -> 409", approveRejected, 409);

  const detail2 = await api("GET", `/api/lab-bookings/${booking2Id}`, {
    cookie: patient2Cookie,
  });
  expectStatus("patient2 reads the rejected booking -> 200", detail2, 200);
  t(
    "rejection reason reaches the patient",
    typeof detail2.json?.data?.rejectionReason === "string",
  );
  t(
    "rejection event recorded with the reason",
    (detail2.json?.data?.history ?? []).some(
      (entry) => entry.eventType === "REQUEST_REJECTED" && Boolean(entry.reason),
    ),
    JSON.stringify((detail2.json?.data?.history ?? []).map((entry) => entry.eventType)),
  );

  /* ---------------- [5] home-collection approval + rejection ---------------- */
  console.log("\n[5] home-collection review through the queue");
  const collectAvail = await api(
    "GET",
    `/api/home-collections/availability?laboratoryId=${labId}&date=${tomorrow}`,
    { cookie: patient1Cookie },
  );
  expectStatus("home-collection availability -> 200", collectAvail, 200);
  const collectSlot = collectAvail.json?.data?.slots?.[0]?.start;
  t("collection slot resolved", typeof collectSlot === "string", String(collectSlot));

  const address = {
    recipientName: "Review Patient One",
    phone: "+91 9100000911",
    addressLine1: "12 MG Road, Flat 4B",
    addressLine2: null,
    landmark: "Near City Mall",
    city: "Pune",
    state: "Maharashtra",
    pincode: "411001",
    latitude: 18.5204,
    longitude: 73.8567,
    instructions: "Ring the second bell",
  };

  const collection1 = await api("POST", "/api/home-collections", {
    cookie: patient1Cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      address,
      scheduledDate: tomorrow,
      timeSlot: collectSlot,
      idempotencyKey: "idem-review-hc1-000001",
    },
  });
  expectStatus("patient1 requests home collection -> 201", collection1, 201);
  const collection1Id = collection1.json?.data?.id;
  t("collection starts PENDING", collection1.json?.data?.status === "PENDING");

  const queueCollections = await api(
    "GET",
    "/api/collection-requests?type=HOME_COLLECTION",
    { cookie: labManager },
  );
  expectStatus("queue filtered to home collections -> 200", queueCollections, 200);
  const collectionRow = (queueCollections.json?.data ?? []).find(
    (row) => row.id === collection1Id,
  );
  t("home-collection request appears in the queue", Boolean(collectionRow));
  t(
    "queue row is typed HOME_COLLECTION",
    collectionRow?.requestType === "HOME_COLLECTION",
    JSON.stringify(collectionRow?.requestType),
  );
  t(
    "home-collection queue row carries the HC reference",
    /^HC-\d{4}-\d{6}$/.test(collectionRow?.reference ?? ""),
    String(collectionRow?.reference),
  );
  t(
    "home-collection queue row has no order total",
    collectionRow?.totalAmount === null,
    String(collectionRow?.totalAmount),
  );

  const typeMismatch = await api(
    "GET",
    "/api/collection-requests?type=LAB_VISIT",
    { cookie: labManager },
  );
  expectStatus("queue filtered to lab visits -> 200", typeMismatch, 200);
  t(
    "type filter hides home collections",
    !(typeMismatch.json?.data ?? []).some(
      (row) => row.requestType === "HOME_COLLECTION",
    ),
  );

  const approveCollection = await api(
    "PATCH",
    `/api/home-collections/${collection1Id}/status`,
    { cookie: labManager, body: { status: "CONFIRMED" } },
  );
  expectStatus("lab manager approves the home collection -> 200", approveCollection, 200);
  t(
    "approval moves the collection to CONFIRMED",
    approveCollection.json?.data?.status === "CONFIRMED",
    String(approveCollection.json?.data?.status),
  );
  t(
    "approval stamps the collection reviewer",
    typeof approveCollection.json?.data?.reviewedAt === "string",
  );

  const queueAfterCollectionApprove = await api(
    "GET",
    "/api/collection-requests?type=HOME_COLLECTION",
    { cookie: labManager },
  );
  const approvedCollectionRow = (queueAfterCollectionApprove.json?.data ?? []).find(
    (row) => row.id === collection1Id,
  );
  t(
    "queue row shows the accepted state",
    approvedCollectionRow?.status === "CONFIRMED",
    String(approvedCollectionRow?.status),
  );

  const collection2 = await api("POST", "/api/home-collections", {
    cookie: patient2Cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      address: { ...address, recipientName: "Review Patient Two" },
      scheduledDate: tomorrow,
      timeSlot: collectSlot,
      idempotencyKey: "idem-review-hc2-000002",
    },
  });
  expectStatus("patient2 requests home collection -> 201", collection2, 201);
  const collection2Id = collection2.json?.data?.id;

  const rejectCollection = await api(
    "PATCH",
    `/api/home-collections/${collection2Id}/reject`,
    { cookie: labManager, body: { reason: "No collector available in that area today." } },
  );
  expectStatus("lab manager rejects the home collection -> 200", rejectCollection, 200);
  t(
    "rejection moves the collection to REJECTED",
    rejectCollection.json?.data?.status === "REJECTED",
    String(rejectCollection.json?.data?.status),
  );

  /* ---------------- [5b] collector assignment + reassignment ---------------- */
  console.log("\n[5b] collector assignment and reassignment lifecycle");
  const collector1Doc = await mongoose.connection.db
    .collection("users")
    .findOne({ email: "review.collector1@example.com" });
  const collector2Doc = await mongoose.connection.db
    .collection("users")
    .findOne({ email: "review.collector2@example.com" });
  t("collector fixtures seeded", Boolean(collector1Doc && collector2Doc));
  const collector1Id = String(collector1Doc?._id ?? "");
  const collector2Id = String(collector2Doc?._id ?? "");

  // Fresh assignment: CONFIRMED -> ASSIGNED through the assign dialog only.
  const assign1 = await api("PATCH", `/api/home-collections/${collection1Id}/assign`, {
    cookie: labManager,
    body: { collectorId: collector1Id },
  });
  expectStatus("assign collector1 -> 200", assign1, 200);
  t(
    "assignment moves CONFIRMED to ASSIGNED",
    assign1.json?.data?.status === "ASSIGNED",
    String(assign1.json?.data?.status),
  );
  t(
    "assignment stamps the collector",
    assign1.json?.data?.collector?.name === "Review Collector One",
    JSON.stringify(assign1.json?.data?.collector),
  );
  t(
    "fresh assignment starts unaccepted",
    assign1.json?.data?.collectorAcceptedAt === null,
    String(assign1.json?.data?.collectorAcceptedAt),
  );

  // ASSIGNED is never reachable through the generic status endpoint.
  const statusAssigned = await api(
    "PATCH",
    `/api/home-collections/${collection1Id}/status`,
    { cookie: labManager, body: { status: "ASSIGNED" } },
  );
  expectStatus("generic status endpoint rejects ASSIGNED -> 400", statusAssigned, 400);

  const accept1 = await api(
    "PATCH",
    `/api/home-collections/${collection1Id}/status`,
    { cookie: collector1.cookie, body: { status: "COLLECTOR_ACCEPTED" } },
  );
  expectStatus("collector1 accepts the assignment -> 200", accept1, 200);
  t(
    "acceptance is stamped for collector1",
    typeof accept1.json?.data?.collectorAcceptedAt === "string",
    String(accept1.json?.data?.collectorAcceptedAt),
  );

  // Reassignment after acceptance: back to ASSIGNED, acceptance cleared.
  const reassign = await api("PATCH", `/api/home-collections/${collection1Id}/assign`, {
    cookie: labManager,
    body: { collectorId: collector2Id },
  });
  expectStatus("reassign to collector2 -> 200", reassign, 200);
  t(
    "reassignment returns the request to ASSIGNED",
    reassign.json?.data?.status === "ASSIGNED",
    String(reassign.json?.data?.status),
  );
  t(
    "reassignment clears the previous acceptance",
    reassign.json?.data?.collectorAcceptedAt === null,
    String(reassign.json?.data?.collectorAcceptedAt),
  );
  t(
    "reassignment stamps the new collector",
    reassign.json?.data?.collector?.name === "Review Collector Two",
    JSON.stringify(reassign.json?.data?.collector),
  );

  const assignSame = await api("PATCH", `/api/home-collections/${collection1Id}/assign`, {
    cookie: labManager,
    body: { collectorId: collector2Id },
  });
  expectStatus("reassigning to the already-assigned collector -> 409", assignSame, 409);

  // The newly assigned collector must be able to accept from scratch.
  const accept2 = await api(
    "PATCH",
    `/api/home-collections/${collection1Id}/status`,
    { cookie: collector2.cookie, body: { status: "COLLECTOR_ACCEPTED" } },
  );
  expectStatus("collector2 accepts after the swap -> 200", accept2, 200);
  t(
    "collector2 acceptance is stamped",
    typeof accept2.json?.data?.collectorAcceptedAt === "string",
    String(accept2.json?.data?.collectorAcceptedAt),
  );

  // The displaced collector no longer sees the request as actionable.
  const staleAccept = await api(
    "PATCH",
    `/api/home-collections/${collection1Id}/status`,
    { cookie: collector1.cookie, body: { status: "COLLECTOR_EN_ROUTE" } },
  );
  expectStatus("displaced collector can no longer act -> 404", staleAccept, 404);

  /* ---------------- [6] queue filters, totals, no duplicates ---------------- */
  console.log("\n[6] queue filters and record integrity");
  const queueAll = await api("GET", "/api/collection-requests?limit=50", {
    cookie: labManager,
  });
  expectStatus("unfiltered queue -> 200", queueAll, 200);

  const bookingCount = await countDocs("labbookings");
  const collectionCount = await countDocs("homecollections");
  t(
    "queue total equals the sum of both stores",
    queueAll.json?.meta?.total === bookingCount + collectionCount,
    `queue=${queueAll.json?.meta?.total} bookings=${bookingCount} collections=${collectionCount}`,
  );
  t(
    "queue rows cover both request types",
    (queueAll.json?.data ?? []).some((row) => row.requestType === "LAB_VISIT") &&
      (queueAll.json?.data ?? []).some((row) => row.requestType === "HOME_COLLECTION"),
    JSON.stringify((queueAll.json?.data ?? []).map((row) => row.requestType)),
  );
  t(
    "queue rows are ordered newest first",
    (() => {
      const rows = queueAll.json?.data ?? [];
      for (let index = 1; index < rows.length; index += 1) {
        if (rows[index - 1].createdAt < rows[index].createdAt) return false;
      }
      return true;
    })(),
  );

  const byReference = await api(
    "GET",
    `/api/collection-requests?search=${booking2Code}`,
    { cookie: labManager },
  );
  expectStatus("queue search by reference -> 200", byReference, 200);
  t(
    "search narrows to the matching booking",
    (byReference.json?.data ?? []).length === 1 &&
      byReference.json?.data[0].id === booking2Id,
    JSON.stringify((byReference.json?.data ?? []).map((row) => row.reference)),
  );

  const byName = await api(
    "GET",
    `/api/collection-requests?search=${encodeURIComponent("Review Patient Two")}`,
    { cookie: labManager },
  );
  expectStatus("queue search by patient name -> 200", byName, 200);
  t(
    "name search returns both of patient2's requests",
    (byName.json?.data ?? []).length === 2,
    String((byName.json?.data ?? []).length),
  );
  t(
    "name search rows belong to patient2",
    (byName.json?.data ?? []).every((row) => row.patientName === "Review Patient Two"),
    JSON.stringify((byName.json?.data ?? []).map((row) => row.patientName)),
  );

  const labVisitQueue = await api(
    "GET",
    "/api/collection-requests?type=LAB_VISIT",
    { cookie: labManager },
  );
  t(
    "lab-visit filter returns only lab visits",
    (labVisitQueue.json?.data ?? []).every((row) => row.requestType === "LAB_VISIT"),
  );

  const dateFiltered = await api(
    "GET",
    `/api/collection-requests?dateFrom=${tomorrow}&dateTo=${tomorrow}`,
    { cookie: labManager },
  );
  expectStatus("queue date-range filter -> 200", dateFiltered, 200);
  t(
    "date filter returns only the scheduled day",
    (dateFiltered.json?.data ?? []).every((row) => row.scheduledDate === tomorrow),
    JSON.stringify((dateFiltered.json?.data ?? []).map((row) => row.scheduledDate)),
  );

  const badRange = await api(
    "GET",
    `/api/collection-requests?dateFrom=${tomorrow}&dateTo=${addDays(tomorrow, -2)}`,
    { cookie: labManager },
  );
  expectStatus("inverted date range -> 400", badRange, 400);

  /* ---------------- [7] online booking management view ---------------- */
  console.log("\n[7] Online Booking management pseudo-filter");
  const managementReviewed = await api("GET", "/api/lab-bookings?status=REVIEWED", {
    cookie: labManager,
  });
  expectStatus("management REVIEWED list -> 200", managementReviewed, 200);
  const reviewedRows = managementReviewed.json?.data ?? [];
  t(
    "REVIEWED contains the approved booking",
    reviewedRows.some((row) => row.id === booking1Id),
  );
  t(
    "REVIEWED contains the rejected booking",
    reviewedRows.some((row) => row.id === booking2Id),
  );
  t(
    "REVIEWED contains no pending bookings",
    reviewedRows.every((row) => row.status !== "PENDING"),
    JSON.stringify(reviewedRows.map((row) => row.status)),
  );
  t(
    "reviewed rows carry the patient name",
    reviewedRows.every((row) => typeof row.patientName === "string"),
    JSON.stringify(reviewedRows.map((row) => row.patientName)),
  );

  const patientOwn = await api("GET", "/api/lab-bookings?status=PENDING", {
    cookie: patient2Cookie,
  });
  expectStatus("patient list with status=PENDING -> 200", patientOwn, 200);
  t(
    "patients still see their own pending bookings",
    (patientOwn.json?.data ?? []).every((row) => row.status === "PENDING"),
  );

  const bookingEventCount = await mongoose.connection.db
    .collection("labbookingevents")
    .countDocuments();
  const collectionEventCount = await mongoose.connection.db
    .collection("homecollectionevents")
    .countDocuments();
  t(
    "booking audit events cover create + approve + create + reject",
    bookingEventCount >= 4,
    String(bookingEventCount),
  );
  t(
    "collection audit events cover create + approve + create + reject",
    collectionEventCount >= 4,
    String(collectionEventCount),
  );
  const reviewEvents = await mongoose.connection.db
    .collection("labbookingevents")
    .find({ eventType: { $in: ["REQUEST_CONFIRMED", "REQUEST_REJECTED"] } })
    .toArray();
  t(
    "booking review events were appended for both reviews",
    reviewEvents.length === 2,
    JSON.stringify(reviewEvents.map((event) => event.eventType)),
  );

  /* ---------------- [8] navigation surfaces (SSR smoke) ---------------- */
  console.log("\n[8] navigation entry points (SSR smoke)");

  const lmDashboard = await page("/lab-manager/dashboard", labManager);
  expectStatus("lab manager dashboard renders -> 200", lmDashboard, 200);
  t(
    "lab manager sidebar links to the booking management list",
    lmDashboard.html.includes('href="/lab-bookings"'),
    "href=/lab-bookings not found",
  );
  t(
    "lab manager surface has no patient create-flow link",
    !lmDashboard.html.includes('href="/bookings"'),
    "href=/bookings leaked into the lab manager surface",
  );

  const bookChoice = await page("/book-a-test", patient1Cookie);
  expectStatus("book-a-test choice page renders for a patient -> 200", bookChoice, 200);
  t(
    "choice page offers the lab-visit flow",
    bookChoice.html.includes('href="/bookings"') &&
      bookChoice.html.includes("Visit a laboratory"),
    "lab-visit card not rendered",
  );
  t(
    "choice page offers the home-collection flow",
    bookChoice.html.includes('href="/home-collection"') &&
      bookChoice.html.includes("Book a home collection"),
    "home-collection card not rendered",
  );
  t(
    "patient sidebar entry points at the choice page",
    bookChoice.html.includes('href="/book-a-test"'),
    "href=/book-a-test not found",
  );

  const collectorDashboard = await page("/collector/dashboard", collector1.cookie);
  expectStatus("collector dashboard renders -> 200", collectorDashboard, 200);
  t(
    "collector dashboard has no Available Pickups dead end",
    !collectorDashboard.html.includes("Available Pickups"),
    "Available Pickups still rendered",
  );
  t(
    "collector dashboard links My Assignments",
    collectorDashboard.html.includes('href="/my-assignments"'),
    "href=/my-assignments not found",
  );
  t(
    "collector dashboard mounts both live widgets",
    collectorDashboard.html.includes("My assignments") &&
      collectorDashboard.html.includes("Today&#x27;s pickups"),
    "collector widget titles not rendered",
  );
  t(
    "collector dashboard placeholder route card is gone",
    !collectorDashboard.html.includes("Today&#x27;s route"),
    "placeholder still rendered",
  );

  const patientDashboard = await page("/patient/dashboard", patient1Cookie);
  expectStatus("patient dashboard renders -> 200", patientDashboard, 200);
  t(
    "patient dashboard offers the four required actions",
    patientDashboard.html.includes('href="/book-a-test"') &&
      patientDashboard.html.includes('href="/my-bookings"') &&
      patientDashboard.html.includes('href="/home-collection"') &&
      patientDashboard.html.includes('href="/profile"'),
    "required action link missing",
  );
  t(
    "patient dashboard mounts both live widgets",
    patientDashboard.html.includes("Upcoming appointments") &&
      patientDashboard.html.includes("Home collection requests"),
    "patient widget titles not rendered",
  );
  t(
    "patient dashboard placeholder activity card is gone",
    !patientDashboard.html.includes("Your recent activity"),
    "placeholder still rendered",
  );

  t(
    "lab manager dashboard links the review queue and collections views",
    lmDashboard.html.includes('href="/home-collections/manage?view=requests"') &&
      lmDashboard.html.includes('href="/home-collections/manage?view=collections"'),
    "manage view link missing",
  );
  t(
    "lab manager dashboard mounts the three live widgets",
    lmDashboard.html.includes("Pending review") &&
      lmDashboard.html.includes("Today&#x27;s lab bookings") &&
      lmDashboard.html.includes("Today&#x27;s home collections"),
    "lab manager widget titles not rendered",
  );
  t(
    "lab manager dashboard placeholder operations card is gone",
    !lmDashboard.html.includes("Lab operations today"),
    "placeholder still rendered",
  );

  const profilePage = await page("/profile", patient1Cookie);
  expectStatus("profile page renders for a patient -> 200", profilePage, 200);
  t(
    "profile shows the signed-in identity",
    profilePage.html.includes("review.patient1@example.com") &&
      profilePage.html.includes("Review Patient One"),
    "own email/name not rendered",
  );
  t(
    "profile never renders another account",
    !profilePage.html.includes("review.patient2@example.com"),
    "another account leaked into the profile",
  );

  const labTestsTab = await page("/lab?tab=tests", labManager);
  expectStatus("lab manager deep link /lab?tab=tests renders -> 200", labTestsTab, 200);

  /* ---- exact dashboard data-source queries (shape + authz) ---- */
  console.log("\n[9] dashboard data-source queries");

  const smokeToday = todayTz();

  const queuePending = await api(
    "GET",
    "/api/collection-requests?status=PENDING&limit=1",
    { cookie: labManager },
  );
  expectStatus("lab manager pending-queue query -> 200", queuePending, 200);
  t(
    "pending-queue response carries an exact meta.total",
    typeof queuePending.json?.meta?.total === "number",
    JSON.stringify(queuePending.json?.meta),
  );

  const queueTodayBookings = await api(
    "GET",
    `/api/collection-requests?type=LAB_VISIT&dateFrom=${smokeToday}&dateTo=${smokeToday}&limit=1`,
    { cookie: labManager },
  );
  expectStatus("lab manager today's lab-bookings query -> 200", queueTodayBookings, 200);
  t(
    "today's lab-bookings response is a shaped list",
    Array.isArray(queueTodayBookings.json?.data) &&
      typeof queueTodayBookings.json?.meta?.total === "number",
    JSON.stringify(queueTodayBookings.json?.meta),
  );

  const queueTodayCollections = await api(
    "GET",
    `/api/collection-requests?type=HOME_COLLECTION&dateFrom=${smokeToday}&dateTo=${smokeToday}&limit=1`,
    { cookie: labManager },
  );
  expectStatus("lab manager today's collections query -> 200", queueTodayCollections, 200);
  t(
    "today's collections response is a shaped list",
    Array.isArray(queueTodayCollections.json?.data),
    JSON.stringify(queueTodayCollections.json?.meta),
  );

  const queueAsPatient = await api(
    "GET",
    "/api/collection-requests?status=PENDING&limit=1",
    { cookie: patient1Cookie },
  );
  expectStatus("queue data source stays closed for patients -> 403", queueAsPatient, 403);

  const patientBookingsQuery = await api("GET", "/api/lab-bookings?limit=25", {
    cookie: patient1Cookie,
  });
  expectStatus("patient upcoming-appointments query -> 200", patientBookingsQuery, 200);
  t(
    "patient bookings response is a shaped list",
    Array.isArray(patientBookingsQuery.json?.data) &&
      typeof patientBookingsQuery.json?.meta?.total === "number",
    JSON.stringify(patientBookingsQuery.json?.meta),
  );

  const patientCollectionsQuery = await api(
    "GET",
    `/api/home-collections?dateFrom=${smokeToday}&limit=6`,
    { cookie: patient1Cookie },
  );
  expectStatus("patient pickup query -> 200", patientCollectionsQuery, 200);

  const collectorTodayQuery = await api(
    "GET",
    `/api/home-collections?dateFrom=${smokeToday}&dateTo=${smokeToday}&limit=6`,
    { cookie: collector1.cookie },
  );
  expectStatus("collector today's-pickups query -> 200", collectorTodayQuery, 200);
  t(
    "collector today rows are a shaped list",
    Array.isArray(collectorTodayQuery.json?.data),
    JSON.stringify(collectorTodayQuery.json?.meta),
  );

  const collectorAwaitingQuery = await api(
    "GET",
    "/api/home-collections?status=ASSIGNED&limit=1",
    { cookie: collector1.cookie },
  );
  expectStatus("collector awaiting-acceptance count query -> 200", collectorAwaitingQuery, 200);
  t(
    "awaiting-acceptance response carries meta.total",
    typeof collectorAwaitingQuery.json?.meta?.total === "number",
    JSON.stringify(collectorAwaitingQuery.json?.meta),
  );

  /* ---------------- [10] pickup completion: OTP lifecycle ---------------- */
  console.log("\n[10] pickup completion: OTP lifecycle and security");
  const homeCollectionsDb = mongoose.connection.db.collection("homecollections");
  const collectionEventsDb = mongoose.connection.db.collection("homecollectionevents");

  const otp1 = collection1.json?.data?.collectionOtp;
  t(
    "creation returned the 6-digit pickup OTP exactly once",
    typeof otp1 === "string" && /^\d{6}$/.test(otp1),
    String(otp1),
  );

  const otpEnRoute = await api("PATCH", `/api/home-collections/${collection1Id}/status`, {
    cookie: collector2.cookie,
    body: { status: "COLLECTOR_EN_ROUTE" },
  });
  expectStatus("assigned collector advances to en route -> 200", otpEnRoute, 200);
  t("en-route transition is stamped", typeof otpEnRoute.json?.data?.enRouteAt === "string");

  const otpArrived = await api("PATCH", `/api/home-collections/${collection1Id}/status`, {
    cookie: collector2.cookie,
    body: { status: "ARRIVED" },
  });
  expectStatus("assigned collector advances to arrived -> 200", otpArrived, 200);
  t("arrival is stamped", typeof otpArrived.json?.data?.arrivedAt === "string");

  const otpBackward = await api("PATCH", `/api/home-collections/${collection1Id}/status`, {
    cookie: labManager,
    body: { status: "COLLECTOR_ACCEPTED" },
  });
  expectStatus("backward status transition -> 409", otpBackward, 409);

  const otpViaStatus = await api("PATCH", `/api/home-collections/${collection1Id}/status`, {
    cookie: labManager,
    body: { status: "COLLECTED" },
  });
  expectStatus("generic status PATCH cannot complete a pickup -> 400", otpViaStatus, 400);
  t(
    "schema rejection names OTP verification as the completion path",
    /otp verification/i.test(JSON.stringify(otpViaStatus.json ?? {})),
    JSON.stringify(otpViaStatus.json),
  );

  const otpAnonVerify = await api("POST", `/api/home-collections/${collection1Id}/verify-otp`, {
    body: { otp: otp1 },
  });
  expectStatus("anonymous OTP submission -> 401", otpAnonVerify, 401);

  const otpOwnerVerify = await api("POST", `/api/home-collections/${collection1Id}/verify-otp`, {
    cookie: patient1Cookie,
    body: { otp: otp1 },
  });
  expectStatus("the owning patient cannot submit the pickup OTP -> 404", otpOwnerVerify, 404);

  const otpDisplacedVerify = await api(
    "POST",
    `/api/home-collections/${collection1Id}/verify-otp`,
    { cookie: collector1.cookie, body: { otp: otp1 } },
  );
  expectStatus("a non-assigned collector cannot submit the OTP -> 404", otpDisplacedVerify, 404);

  const otpMissingPayload = await api(
    "POST",
    `/api/home-collections/${collection1Id}/verify-otp`,
    { cookie: collector2.cookie, body: {} },
  );
  expectStatus("OTP payload shape is validated -> 400", otpMissingPayload, 400);

  await homeCollectionsDb.updateOne(
    { _id: new mongoose.Types.ObjectId(collection1Id) },
    { $set: { otpExpiresAt: new Date(Date.now() - 60_000) } },
  );
  const otpExpired = await api("POST", `/api/home-collections/${collection1Id}/verify-otp`, {
    cookie: collector2.cookie,
    body: { otp: otp1 },
  });
  expectStatus("expired OTP verification -> 410", otpExpired, 410);
  t(
    "expiry rejection is explicit",
    /expired/i.test(otpExpired.json?.error ?? ""),
    otpExpired.json?.error,
  );

  /* ---- a fresh request carries cooldown + recovery rules ---- */
  const otpSlot2 = collectAvail.json?.data?.slots?.[1]?.start;
  t("second pickup slot resolved", typeof otpSlot2 === "string", String(otpSlot2));
  const otpRecovery = await api("POST", "/api/home-collections", {
    cookie: patient1Cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      address,
      scheduledDate: tomorrow,
      timeSlot: otpSlot2,
      idempotencyKey: "idem-review-hc3-000003",
    },
  });
  expectStatus("fresh pickup request for the recovery flow -> 201", otpRecovery, 201);
  const otpRecoveryId = otpRecovery.json?.data?.id;
  const otpRecoveryCode = otpRecovery.json?.data?.collectionOtp;

  const otpCooldownRegen = await api(
    "POST",
    `/api/home-collections/${otpRecoveryId}/regenerate-otp`,
    { cookie: patient1Cookie },
  );
  expectStatus("regeneration inside the cooldown window -> 429", otpCooldownRegen, 429);
  t(
    "cooldown asks the patient to wait",
    /wait/i.test(otpCooldownRegen.json?.error ?? ""),
    otpCooldownRegen.json?.error,
  );

  const otpAnonRegen = await api(
    "POST",
    `/api/home-collections/${otpRecoveryId}/regenerate-otp`,
  );
  expectStatus("anonymous regeneration -> 401", otpAnonRegen, 401);

  const otpCollectorRegen = await api(
    "POST",
    `/api/home-collections/${otpRecoveryId}/regenerate-otp`,
    { cookie: collector2.cookie },
  );
  expectStatus("a collector cannot regenerate the patient's OTP -> 404", otpCollectorRegen, 404);

  const otpOpsRegen = await api(
    "POST",
    `/api/home-collections/${otpRecoveryId}/regenerate-otp`,
    { cookie: labManager },
  );
  expectStatus("an operational role cannot regenerate the patient's OTP -> 404", otpOpsRegen, 404);

  const otpOpsPendingVerify = await api(
    "POST",
    `/api/home-collections/${otpRecoveryId}/verify-otp`,
    { cookie: labManager, body: { otp: otpRecoveryCode } },
  );
  expectStatus("OTP verification from PENDING -> 409", otpOpsPendingVerify, 409);

  /* ---- patient recovery: rotation, lock, reset, single-winner completion ---- */
  await homeCollectionsDb.updateOne(
    { _id: new mongoose.Types.ObjectId(collection1Id) },
    { $set: { otpIssuedAt: new Date(Date.now() - 120_000) } },
  );
  const otpRegenOne = await api(
    "POST",
    `/api/home-collections/${collection1Id}/regenerate-otp`,
    { cookie: patient1Cookie },
  );
  expectStatus("patient regenerates after the cooldown -> 200", otpRegenOne, 200);
  const otpTwo = otpRegenOne.json?.data?.collectionOtp;
  t(
    "regeneration returns a fresh 6-digit OTP",
    typeof otpTwo === "string" && /^\d{6}$/.test(otpTwo),
    String(otpTwo),
  );
  t(
    "regeneration keeps the pickup state",
    otpRegenOne.json?.data?.status === "ARRIVED",
    String(otpRegenOne.json?.data?.status),
  );
  t(
    "regeneration issues a future expiry",
    new Date(otpRegenOne.json?.data?.collectionOtpExpiresAt).getTime() > Date.now(),
    String(otpRegenOne.json?.data?.collectionOtpExpiresAt),
  );

  // Event `collectionId` is stored as an ObjectId (schema cast on save), so a
  // raw driver query must match with an ObjectId, not the string id.
  const otpFirstRotations = await collectionEventsDb.countDocuments({
    collectionId: new mongoose.Types.ObjectId(collection1Id),
    eventType: "OTP_REGENERATED",
  });
  t("one OTP rotation is on the audit trail", otpFirstRotations === 1, String(otpFirstRotations));

  const otpStaleVerify = await api("POST", `/api/home-collections/${collection1Id}/verify-otp`, {
    cookie: collector2.cookie,
    body: { otp: otp1 },
  });
  expectStatus("the superseded OTP no longer verifies -> 400", otpStaleVerify, 400);

  const otpWrong = otpTwo === "000000" ? "123456" : "000000";
  const otpWrongResults = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    otpWrongResults.push(
      await api("POST", `/api/home-collections/${collection1Id}/verify-otp`, {
        cookie: collector2.cookie,
        body: { otp: otpWrong },
      }),
    );
  }
  t(
    "wrong attempts inside the limit answer 400",
    otpWrongResults.every((res) => res.status === 400),
    JSON.stringify(otpWrongResults.map((res) => res.status)),
  );

  const otpWrongFinal = await api("POST", `/api/home-collections/${collection1Id}/verify-otp`, {
    cookie: collector2.cookie,
    body: { otp: otpWrong },
  });
  expectStatus("the fifth wrong attempt locks the OTP -> 410", otpWrongFinal, 410);
  t(
    "lock rejection is explicit",
    /too many|attempts/i.test(otpWrongFinal.json?.error ?? ""),
    otpWrongFinal.json?.error,
  );

  const otpCorrectLocked = await api(
    "POST",
    `/api/home-collections/${collection1Id}/verify-otp`,
    { cookie: collector2.cookie, body: { otp: otpTwo } },
  );
  expectStatus("the correct OTP is refused while locked -> 410", otpCorrectLocked, 410);

  const otpLockedDoc = await homeCollectionsDb.findOne(
    { _id: new mongoose.Types.ObjectId(collection1Id) },
    { projection: { otpAttempts: 1 } },
  );
  t(
    "the attempt counter reached the configured maximum",
    (otpLockedDoc?.otpAttempts ?? 0) >= 5,
    String(otpLockedDoc?.otpAttempts),
  );

  await homeCollectionsDb.updateOne(
    { _id: new mongoose.Types.ObjectId(collection1Id) },
    { $set: { otpIssuedAt: new Date(Date.now() - 120_000) } },
  );
  const otpRegenTwo = await api(
    "POST",
    `/api/home-collections/${collection1Id}/regenerate-otp`,
    { cookie: patient1Cookie },
  );
  expectStatus("patient recovers from the lock -> 200", otpRegenTwo, 200);
  const otpThree = otpRegenTwo.json?.data?.collectionOtp;
  t(
    "recovery returns another fresh OTP",
    typeof otpThree === "string" && /^\d{6}$/.test(otpThree),
    String(otpThree),
  );
  const otpSecondRotations = await collectionEventsDb.countDocuments({
    collectionId: new mongoose.Types.ObjectId(collection1Id),
    eventType: "OTP_REGENERATED",
  });
  t("two OTP rotations are on the audit trail", otpSecondRotations === 2, String(otpSecondRotations));

  const [otpRaceA, otpRaceB] = await Promise.all([
    api("POST", `/api/home-collections/${collection1Id}/verify-otp`, {
      cookie: collector2.cookie,
      body: { otp: otpThree },
    }),
    api("POST", `/api/home-collections/${collection1Id}/verify-otp`, {
      cookie: collector2.cookie,
      body: { otp: otpThree },
    }),
  ]);
  const otpRaceStatuses = [otpRaceA.status, otpRaceB.status].sort((a, b) => a - b);
  t(
    "concurrent OTP submissions produce exactly one winner",
    otpRaceStatuses[0] === 200 && otpRaceStatuses[1] === 409,
    JSON.stringify(otpRaceStatuses),
  );
  t(
    "the winning submission completes the pickup",
    [otpRaceA, otpRaceB].some((res) => res.json?.data?.status === "COLLECTED"),
  );

  const otpCompletedEvents = await collectionEventsDb.countDocuments({
    collectionId: new mongoose.Types.ObjectId(collection1Id),
    eventType: "COLLECTION_COMPLETED",
  });
  t("a single completion event is recorded", otpCompletedEvents === 1, String(otpCompletedEvents));

  // Once the pickup is COLLECTED the assigned collector's ACTION authorization
  // lapses (canActOnAssignedCollection requires an actionable status), so the
  // action endpoints answer 404 while the detail route still serves 200 -
  // documented "no existence probing" behavior, pinned here as-is. Ops roles
  // pass the authz gate and hit the explicit status rules instead (409).
  const otpRepeatVerify = await api(
    "POST",
    `/api/home-collections/${collection1Id}/verify-otp`,
    { cookie: collector2.cookie, body: { otp: otpThree } },
  );
  expectStatus("assigned collector repeat verification after completion -> 404", otpRepeatVerify, 404);

  const otpRepeatVerifyOps = await api(
    "POST",
    `/api/home-collections/${collection1Id}/verify-otp`,
    { cookie: labManager, body: { otp: otpThree } },
  );
  expectStatus("operator repeat verification after completion -> 409", otpRepeatVerifyOps, 409);

  const otpRegenAfter = await api(
    "POST",
    `/api/home-collections/${collection1Id}/regenerate-otp`,
    { cookie: patient1Cookie },
  );
  expectStatus("regeneration after completion -> 409", otpRegenAfter, 409);

  const otpStatusAfter = await api("PATCH", `/api/home-collections/${collection1Id}/status`, {
    cookie: collector2.cookie,
    body: { status: "COLLECTOR_EN_ROUTE" },
  });
  expectStatus("assigned collector cannot move a completed pickup -> 404", otpStatusAfter, 404);

  const otpStatusAfterOps = await api("PATCH", `/api/home-collections/${collection1Id}/status`, {
    cookie: labManager,
    body: { status: "COLLECTOR_EN_ROUTE" },
  });
  expectStatus("operator cannot move a completed pickup -> 409", otpStatusAfterOps, 409);

  const otpCompletedDetail = await api("GET", `/api/home-collections/${collection1Id}`, {
    cookie: patient1Cookie,
  });
  expectStatus("the owner sees the completed pickup -> 200", otpCompletedDetail, 200);
  t(
    "detail reports the collected state",
    otpCompletedDetail.json?.data?.status === "COLLECTED",
    String(otpCompletedDetail.json?.data?.status),
  );
  t(
    "the owner's audit timeline includes rotation and completion",
    Array.isArray(otpCompletedDetail.json?.data?.history) &&
      otpCompletedDetail.json.data.history.some(
        (event) => event.eventType === "COLLECTION_COMPLETED",
      ) &&
      otpCompletedDetail.json.data.history.some(
        (event) => event.eventType === "OTP_REGENERATED",
      ),
    JSON.stringify(
      (otpCompletedDetail.json?.data?.history ?? []).map((event) => event.eventType),
    ),
  );

  /* ---------------- [11] security, idempotency, capacity, counts ---------------- */
  console.log("\n[11] security matrix, idempotency, capacity and cancellation");

  /* ---- anonymous callers are refused everywhere ---- */
  const secAnonList = await api("GET", "/api/home-collections");
  expectStatus("anonymous collection list -> 401", secAnonList, 401);
  const secAnonDetail = await api("GET", `/api/home-collections/${collection1Id}`);
  expectStatus("anonymous collection detail -> 401", secAnonDetail, 401);
  const secAnonCreate = await api("POST", "/api/home-collections", { body: {} });
  expectStatus("anonymous collection create -> 401", secAnonCreate, 401);
  const secAnonAssign = await api("PATCH", `/api/home-collections/${collection1Id}/assign`, {
    body: { collectorId: collector2Id },
  });
  expectStatus("anonymous assign -> 401", secAnonAssign, 401);
  const secAnonStatus = await api("PATCH", `/api/home-collections/${collection1Id}/status`, {
    body: { status: "CONFIRMED" },
  });
  expectStatus("anonymous status change -> 401", secAnonStatus, 401);
  const secAnonCancel = await api("PATCH", `/api/home-collections/${collection1Id}/cancel`, {
    body: { reason: "not mine" },
  });
  expectStatus("anonymous cancellation -> 401", secAnonCancel, 401);
  const secAnonVerify = await api(
    "POST",
    `/api/home-collections/${collection1Id}/verify-otp`,
    { body: { otp: "123456" } },
  );
  expectStatus("anonymous OTP verification -> 401", secAnonVerify, 401);
  const secAnonRegen = await api(
    "POST",
    `/api/home-collections/${collection1Id}/regenerate-otp`,
  );
  expectStatus("anonymous OTP regeneration -> 401", secAnonRegen, 401);

  /* ---- cross-user reads and writes ---- */
  const secPatient2Foreign = await api("GET", `/api/home-collections/${collection1Id}`, {
    cookie: patient2Cookie,
  });
  expectStatus("another patient's collection detail -> 404", secPatient2Foreign, 404);
  const secPatient2Own = await api("GET", `/api/home-collections/${collection2Id}`, {
    cookie: patient2Cookie,
  });
  expectStatus("their own rejected request stays visible -> 200", secPatient2Own, 200);

  const secCollector1Foreign = await api("GET", `/api/home-collections/${collection1Id}`, {
    cookie: collector1.cookie,
  });
  expectStatus("a displaced collector's detail read -> 404", secCollector1Foreign, 404);
  const secCollector2Own = await api("GET", `/api/home-collections/${collection1Id}`, {
    cookie: collector2.cookie,
  });
  expectStatus("the assigned collector's detail read -> 200", secCollector2Own, 200);

  const secPatientAssign = await api(
    "PATCH",
    `/api/home-collections/${collection1Id}/assign`,
    { cookie: patient1Cookie, body: { collectorId: collector1Id } },
  );
  expectStatus("a patient cannot assign collectors -> 403", secPatientAssign, 403);
  const secPatientReject = await api(
    "PATCH",
    `/api/home-collections/${collection2Id}/reject`,
    { cookie: patient1Cookie, body: { reason: "not my request to reject" } },
  );
  expectStatus("a patient cannot reject requests -> 403", secPatientReject, 403);
  const secPatientCancelForeign = await api(
    "PATCH",
    `/api/home-collections/${collection2Id}/cancel`,
    { cookie: patient1Cookie, body: { reason: "trying my luck" } },
  );
  expectStatus("a patient cannot cancel another's request -> 404", secPatientCancelForeign, 404);

  const secDoctorList = await api("GET", "/api/home-collections", { cookie: doctor });
  expectStatus("doctor collection list -> 403", secDoctorList, 403);

  /* ---- collector lists are hard-scoped to their own assignments ---- */
  const secCollector2List = await api("GET", "/api/home-collections?limit=50", {
    cookie: collector2.cookie,
  });
  expectStatus("collector2 list -> 200", secCollector2List, 200);
  const secCollector2Db = await homeCollectionsDb.countDocuments({
    assignedCollectorId: new mongoose.Types.ObjectId(collector2Id),
  });
  t(
    "collector2 sees exactly their own assignments",
    secCollector2List.json?.meta?.total === secCollector2Db &&
      (secCollector2List.json?.data ?? []).every((row) => row.collector?.id === collector2Id),
    `list=${secCollector2List.json?.meta?.total} db=${secCollector2Db}`,
  );

  const secCollector1List = await api("GET", "/api/home-collections?limit=50", {
    cookie: collector1.cookie,
  });
  expectStatus("collector1 list -> 200", secCollector1List, 200);
  t(
    "the displaced collector sees no assignments",
    secCollector1List.json?.meta?.total === 0 &&
      (secCollector1List.json?.data ?? []).length === 0,
    JSON.stringify(secCollector1List.json?.meta),
  );

  /* ---- patient lists are hard-scoped to their own records ---- */
  const secPatient1Collections = await api("GET", "/api/home-collections?limit=50", {
    cookie: patient1Cookie,
  });
  expectStatus("patient1 collection list -> 200", secPatient1Collections, 200);
  const secPatient1CollectionsDb = await homeCollectionsDb.countDocuments({
    patientId: new mongoose.Types.ObjectId(p1.user.id),
  });
  t(
    "patient1's collection list matches their own records only",
    secPatient1Collections.json?.meta?.total === secPatient1CollectionsDb &&
      (secPatient1Collections.json?.data ?? []).every((row) => row.id !== collection2Id),
    `list=${secPatient1Collections.json?.meta?.total} db=${secPatient1CollectionsDb}`,
  );

  const secPatient1Bookings = await api("GET", "/api/lab-bookings?limit=50", {
    cookie: patient1Cookie,
  });
  expectStatus("patient1 booking list -> 200", secPatient1Bookings, 200);
  const secPatient1BookingsDb = await mongoose.connection.db
    .collection("labbookings")
    .countDocuments({ patientId: new mongoose.Types.ObjectId(p1.user.id) });
  t(
    "patient1's booking list matches their own records only",
    secPatient1Bookings.json?.meta?.total === secPatient1BookingsDb &&
      (secPatient1Bookings.json?.data ?? []).every((row) => row.id !== booking2Id),
    `list=${secPatient1Bookings.json?.meta?.total} db=${secPatient1BookingsDb}`,
  );

  /* ---- idempotent replay and concurrent duplicate submission ---- */
  const secSlot3 = collectAvail.json?.data?.slots?.[2]?.start;
  t("capacity slot resolved", typeof secSlot3 === "string", String(secSlot3));
  const secReplayBody = {
    laboratoryId: labId,
    testIds: [testId],
    address,
    scheduledDate: tomorrow,
    timeSlot: secSlot3,
    idempotencyKey: "idem-review-hc-replay-000001",
  };
  const secReplayCreate = await api("POST", "/api/home-collections", {
    cookie: patient1Cookie,
    body: secReplayBody,
  });
  expectStatus("first submission of a new request -> 201", secReplayCreate, 201);
  const secReplayId = secReplayCreate.json?.data?.id;
  t(
    "creation hands back the OTP once",
    typeof secReplayCreate.json?.data?.collectionOtp === "string",
    String(secReplayCreate.json?.data?.collectionOtp),
  );

  const secReplayAgain = await api("POST", "/api/home-collections", {
    cookie: patient1Cookie,
    body: secReplayBody,
  });
  expectStatus("idempotent replay answers 200", secReplayAgain, 200);
  t("replay returns the original record", secReplayAgain.json?.data?.id === secReplayId);
  t(
    "replay never re-exposes the OTP",
    secReplayAgain.json?.data?.collectionOtp == null,
    String(secReplayAgain.json?.data?.collectionOtp),
  );
  const secReplayKeyCount = await homeCollectionsDb.countDocuments({
    idempotencyKey: "idem-review-hc-replay-000001",
  });
  t("the replay key maps to a single record", secReplayKeyCount === 1, String(secReplayKeyCount));

  const secReplayDifferent = await api("POST", "/api/home-collections", {
    cookie: patient1Cookie,
    body: { ...secReplayBody, timeSlot: collectAvail.json?.data?.slots?.[5]?.start },
  });
  t(
    "same key with a different payload still returns the original",
    secReplayDifferent.json?.data?.id === secReplayId &&
      secReplayDifferent.json?.data?.timeSlot === secSlot3,
    JSON.stringify(secReplayDifferent.json?.data?.timeSlot),
  );

  const secRaceSlot = collectAvail.json?.data?.slots?.[3]?.start;
  const secRaceKey = "idem-review-hc-race-000001";
  const secRaceBody = {
    laboratoryId: labId,
    testIds: [testId],
    address,
    scheduledDate: tomorrow,
    timeSlot: secRaceSlot,
    idempotencyKey: secRaceKey,
  };
  const [secRaceA, secRaceB] = await Promise.all([
    api("POST", "/api/home-collections", { cookie: patient1Cookie, body: secRaceBody }),
    api("POST", "/api/home-collections", { cookie: patient1Cookie, body: secRaceBody }),
  ]);
  const secRaceStatuses = [secRaceA.status, secRaceB.status].sort((a, b) => a - b);
  t(
    "concurrent duplicates create one record and replay the other",
    secRaceStatuses[0] === 200 && secRaceStatuses[1] === 201,
    JSON.stringify(secRaceStatuses),
  );
  t(
    "both racers agree on the record",
    Boolean(secRaceA.json?.data?.id) && secRaceA.json?.data?.id === secRaceB.json?.data?.id,
    JSON.stringify([secRaceA.json?.data?.id, secRaceB.json?.data?.id]),
  );
  const secRaceKeyCount = await homeCollectionsDb.countDocuments({
    idempotencyKey: secRaceKey,
  });
  t("the raced key maps to a single record", secRaceKeyCount === 1, String(secRaceKeyCount));

  /* ---- capacity holds and cancellation release ---- */
  const secFillKeys = [
    "idem-review-hc-fill-a",
    "idem-review-hc-fill-b",
    "idem-review-hc-fill-c",
  ];
  const secFillCookies = [patient2Cookie, patient1Cookie, patient2Cookie];
  const secFillerIds = [];
  for (let index = 0; index < secFillKeys.length; index += 1) {
    const secFilled = await api("POST", "/api/home-collections", {
      cookie: secFillCookies[index],
      body: {
        laboratoryId: labId,
        testIds: [testId],
        address: {
          ...address,
          recipientName: index % 2 === 0 ? "Review Patient Two" : "Review Patient One",
        },
        scheduledDate: tomorrow,
        timeSlot: secSlot3,
        idempotencyKey: secFillKeys[index],
      },
    });
    expectStatus(`slot filler ${index + 1} -> 201`, secFilled, 201);
    secFillerIds.push(secFilled.json?.data?.id);
  }

  const secOverflow = await api("POST", "/api/home-collections", {
    cookie: patient1Cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      address,
      scheduledDate: tomorrow,
      timeSlot: secSlot3,
      idempotencyKey: "idem-review-hc-overflow",
    },
  });
  expectStatus("fifth request into a full slot -> 409", secOverflow, 409);
  t(
    "capacity rejection is explicit",
    /fully booked|capacity/i.test(secOverflow.json?.error ?? ""),
    secOverflow.json?.error,
  );

  const secAvailFull = await api(
    "GET",
    `/api/home-collections/availability?laboratoryId=${labId}&date=${tomorrow}`,
    { cookie: patient1Cookie },
  );
  const secFullSlot = (secAvailFull.json?.data?.slots ?? []).find(
    (slot) => slot.start === secSlot3,
  );
  t(
    "availability reports the slot as full",
    secFullSlot?.available === false && secFullSlot?.remaining === 0,
    JSON.stringify(secFullSlot),
  );

  const secCancelled = await api(
    "PATCH",
    `/api/home-collections/${secFillerIds[1]}/cancel`,
    { cookie: patient1Cookie, body: { reason: "Duplicate request placed by mistake." } },
  );
  expectStatus("owner cancels a capacity-holding request -> 200", secCancelled, 200);
  t(
    "cancellation is recorded",
    secCancelled.json?.data?.status === "CANCELLED" &&
      typeof secCancelled.json?.data?.cancelledAt === "string",
    String(secCancelled.json?.data?.status),
  );

  const secCancelAgain = await api(
    "PATCH",
    `/api/home-collections/${secFillerIds[1]}/cancel`,
    { cookie: patient1Cookie, body: {} },
  );
  expectStatus("double cancellation -> 409", secCancelAgain, 409);

  const secAvailFreed = await api(
    "GET",
    `/api/home-collections/availability?laboratoryId=${labId}&date=${tomorrow}`,
    { cookie: patient1Cookie },
  );
  const secFreedSlot = (secAvailFreed.json?.data?.slots ?? []).find(
    (slot) => slot.start === secSlot3,
  );
  t(
    "cancellation releases the seat",
    secFreedSlot?.available === true && secFreedSlot?.remaining === 1,
    JSON.stringify(secFreedSlot),
  );

  const secRefilled = await api("POST", "/api/home-collections", {
    cookie: patient1Cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      address,
      scheduledDate: tomorrow,
      timeSlot: secSlot3,
      idempotencyKey: "idem-review-hc-refill",
    },
  });
  expectStatus("the released seat can be rebooked -> 201", secRefilled, 201);

  const secAvailRefilled = await api(
    "GET",
    `/api/home-collections/availability?laboratoryId=${labId}&date=${tomorrow}`,
    { cookie: patient1Cookie },
  );
  const secRefilledSlot = (secAvailRefilled.json?.data?.slots ?? []).find(
    (slot) => slot.start === secSlot3,
  );
  t(
    "the seat is held again after rebooking",
    secRefilledSlot?.available === false && secRefilledSlot?.remaining === 0,
    JSON.stringify(secRefilledSlot),
  );

  /* ---- dashboard data-source counts stay exact ---- */
  const secLmPending = await api(
    "GET",
    "/api/collection-requests?status=PENDING&limit=1",
    { cookie: labManager },
  );
  expectStatus("lab manager pending queue -> 200", secLmPending, 200);
  const secPendingBookings = await mongoose.connection.db
    .collection("labbookings")
    .countDocuments({ status: "PENDING" });
  const secPendingCollections = await homeCollectionsDb.countDocuments({ status: "PENDING" });
  t(
    "pending queue total equals both stores",
    secLmPending.json?.meta?.total === secPendingBookings + secPendingCollections,
    `queue=${secLmPending.json?.meta?.total} bookings=${secPendingBookings} collections=${secPendingCollections}`,
  );

  const secCollectorTomorrow = await api(
    "GET",
    `/api/home-collections?dateFrom=${tomorrow}&dateTo=${tomorrow}&limit=6`,
    { cookie: collector2.cookie },
  );
  expectStatus("collector2 tomorrow query -> 200", secCollectorTomorrow, 200);
  const secTomorrowUtc = new Date(`${tomorrow}T00:00:00.000Z`);
  const secCollectorTomorrowDb = await homeCollectionsDb.countDocuments({
    assignedCollectorId: new mongoose.Types.ObjectId(collector2Id),
    scheduledDate: { $gte: secTomorrowUtc, $lte: secTomorrowUtc },
  });
  t(
    "collector2 tomorrow count is exact",
    secCollectorTomorrow.json?.meta?.total === secCollectorTomorrowDb,
    `list=${secCollectorTomorrow.json?.meta?.total} db=${secCollectorTomorrowDb}`,
  );

  const secPatientToday = await api(
    "GET",
    `/api/home-collections?dateFrom=${smokeToday}&limit=6`,
    { cookie: patient1Cookie },
  );
  expectStatus("patient1 upcoming query -> 200", secPatientToday, 200);
  const secTodayUtc = new Date(`${smokeToday}T00:00:00.000Z`);
  const secPatientTodayDb = await homeCollectionsDb.countDocuments({
    patientId: new mongoose.Types.ObjectId(p1.user.id),
    scheduledDate: { $gte: secTodayUtc },
  });
  t(
    "patient1 upcoming count is exact",
    secPatientToday.json?.meta?.total === secPatientTodayDb,
    `list=${secPatientToday.json?.meta?.total} db=${secPatientTodayDb}`,
  );

  /* ---------------- [12] laboratory scope semantics ---------------- */
  console.log("\n[12] laboratory scope semantics (platform-wide by design)");

  const scopeLab2Res = await api("POST", "/api/laboratories", {
    cookie: superAdmin,
    body: {
      name: "Review Second Lab",
      code: "RW-2",
      city: "Mumbai",
      state: "Maharashtra",
      bookingConfig: {
        timezone: TZ,
        operatingDays: [0, 1, 2, 3, 4, 5, 6],
        openingTime: "08:00",
        closingTime: "20:00",
        slotDurationMinutes: 30,
        slotCapacity: 2,
        maxAdvanceDays: 30,
      },
    },
  });
  expectStatus("second laboratory for scope checks -> 201", scopeLab2Res, 201);
  const scopeLab2Id = scopeLab2Res.json?.data?.id;

  const scopeLab2Dept = await api("POST", `/api/laboratories/${scopeLab2Id}/departments`, {
    cookie: superAdmin,
    body: { laboratoryId: scopeLab2Id, name: "Microbiology", code: "RW-MICRO" },
  });
  expectStatus("second laboratory department -> 201", scopeLab2Dept, 201);

  const scopeLab2Test = await api("POST", "/api/lab-tests", {
    cookie: superAdmin,
    body: {
      laboratoryId: scopeLab2Id,
      departmentId: scopeLab2Dept.json?.data?.id,
      name: "Review Urine Culture",
      code: "RW-UC",
      category: "Microbiology",
      specimenType: "Urine",
      turnaroundTimeMinutes: 1440,
      price: 300,
      labVisitEnabled: true,
      homeCollectionEnabled: false,
    },
  });
  expectStatus("second laboratory bookable test -> 201", scopeLab2Test, 201);

  const scopeLab2Avail = await api(
    "GET",
    `/api/lab-bookings/availability?laboratoryId=${scopeLab2Id}&date=${tomorrow}`,
    { cookie: patient1Cookie },
  );
  expectStatus("second laboratory availability -> 200", scopeLab2Avail, 200);
  const scopeLab2Slot = scopeLab2Avail.json?.data?.slots?.[0]?.start;
  t("second laboratory slot resolved", typeof scopeLab2Slot === "string", String(scopeLab2Slot));

  const scopeLab2Booking = await api("POST", "/api/lab-bookings", {
    cookie: patient1Cookie,
    body: {
      laboratoryId: scopeLab2Id,
      testIds: [scopeLab2Test.json?.data?.id],
      bookingDate: tomorrow,
      timeSlot: scopeLab2Slot,
      idempotencyKey: "idem-review-lab2-booking-0001",
    },
  });
  expectStatus("patient books at the second laboratory -> 201", scopeLab2Booking, 201);
  const scopeLab2BookingId = scopeLab2Booking.json?.data?.id;

  const scopeQueueAll = await api("GET", "/api/collection-requests?limit=50", {
    cookie: labManager,
  });
  expectStatus("unfiltered management queue -> 200", scopeQueueAll, 200);
  t(
    "the queue shows every laboratory by default (documented design)",
    (scopeQueueAll.json?.data ?? []).some((row) => row.id === scopeLab2BookingId) &&
      (scopeQueueAll.json?.data ?? []).some((row) => row.id === booking1Id),
    JSON.stringify((scopeQueueAll.json?.data ?? []).map((row) => row.id)),
  );

  const scopeLab1Queue = await api(
    "GET",
    `/api/collection-requests?laboratory=${labId}&limit=50`,
    { cookie: labManager },
  );
  expectStatus("queue filtered to the first laboratory -> 200", scopeLab1Queue, 200);
  const scopeLab1DbTotal =
    (await mongoose.connection.db
      .collection("labbookings")
      .countDocuments({ laboratoryId: new mongoose.Types.ObjectId(labId) })) +
    (await homeCollectionsDb.countDocuments({
      laboratoryId: new mongoose.Types.ObjectId(labId),
    }));
  t(
    "laboratory filter counts exactly that laboratory's records",
    scopeLab1Queue.json?.meta?.total === scopeLab1DbTotal,
    `filtered=${scopeLab1Queue.json?.meta?.total} db=${scopeLab1DbTotal}`,
  );
  t(
    "the laboratory filter hides the other laboratory's requests",
    (scopeLab1Queue.json?.data ?? []).every((row) => row.laboratory?.id === labId) &&
      !(scopeLab1Queue.json?.data ?? []).some((row) => row.id === scopeLab2BookingId),
    JSON.stringify((scopeLab1Queue.json?.data ?? []).map((row) => row.laboratory?.id)),
  );

  const scopeLab2Queue = await api(
    "GET",
    `/api/collection-requests?laboratory=${scopeLab2Id}&limit=50`,
    { cookie: labManager },
  );
  expectStatus("queue filtered to the second laboratory -> 200", scopeLab2Queue, 200);
  const scopeLab2DbTotal =
    (await mongoose.connection.db
      .collection("labbookings")
      .countDocuments({ laboratoryId: new mongoose.Types.ObjectId(scopeLab2Id) })) +
    (await homeCollectionsDb.countDocuments({
      laboratoryId: new mongoose.Types.ObjectId(scopeLab2Id),
    }));
  t(
    "the second laboratory's filtered total is exact",
    scopeLab2Queue.json?.meta?.total === scopeLab2DbTotal,
    `filtered=${scopeLab2Queue.json?.meta?.total} db=${scopeLab2DbTotal}`,
  );
  t(
    "filtered rows all carry the requested laboratory",
    (scopeLab2Queue.json?.data ?? []).every((row) => row.laboratory?.id === scopeLab2Id),
    JSON.stringify((scopeLab2Queue.json?.data ?? []).map((row) => row.laboratory?.id)),
  );

  const scopeBadFilter = await api(
    "GET",
    "/api/collection-requests?laboratory=not-an-id",
    { cookie: labManager },
  );
  expectStatus("malformed laboratory filter -> 400", scopeBadFilter, 400);

  const scopeLmDetail = await api("GET", `/api/lab-bookings/${scopeLab2BookingId}`, {
    cookie: labManager,
  });
  expectStatus(
    "lab manager detail access spans laboratories (documented design) -> 200",
    scopeLmDetail,
    200,
  );
  const scopeStaffQueue = await api(
    "GET",
    `/api/collection-requests?laboratory=${scopeLab2Id}&limit=50`,
    { cookie: staff },
  );
  expectStatus(
    "staff queue access spans laboratories (documented design) -> 200",
    scopeStaffQueue,
    200,
  );

  const scopePatientList = await api("GET", "/api/lab-bookings?limit=50", {
    cookie: patient1Cookie,
  });
  expectStatus("patient booking list after the second lab -> 200", scopePatientList, 200);
  t(
    "a patient still sees their own requests across laboratories",
    (scopePatientList.json?.data ?? []).some((row) => row.id === scopeLab2BookingId) &&
      (scopePatientList.json?.data ?? []).every((row) => row.id !== booking2Id),
    JSON.stringify((scopePatientList.json?.data ?? []).map((row) => row.id)),
  );

  /* ---------------- [13] per-laboratory assignment API + scoping -------- */
  console.log("\n[13] per-laboratory scope assignment and enforcement");

  // Scoped fixtures: explicit sets on LM accounts (empty + non-empty), while
  // the pre-P1 `labManager` fixture (no stored field) stays the legacy
  // platform-wide case asserted in [12].
  const scopeNow = new Date();
  const scopeHash = bcrypt.hashSync(PASSWORD, 10);
  const scopeFixtureDocs = [
    ["Review Scope A", "review.scope.a@example.com", [labId]],
    ["Review Scope B", "review.scope.b@example.com", [scopeLab2Id]],
    ["Review Scope AB", "review.scope.ab@example.com", [labId, scopeLab2Id]],
    ["Review Scope Empty", "review.scope.empty@example.com", []],
  ].map(([name, email, laboratoryIds], index) => ({
    name,
    email,
    phone: `+91 91000003${String(index).padStart(2, "0")}`,
    passwordHash: scopeHash,
    role: "LAB_MANAGER",
    isActive: true,
    laboratoryIds,
    createdAt: scopeNow,
    updatedAt: scopeNow,
  }));
  const scopeInsert = await mongoose.connection.db
    .collection("users")
    .insertMany(scopeFixtureDocs);
  t(
    "scoped laboratory fixture accounts created",
    scopeInsert.insertedCount === 4,
    String(scopeInsert.insertedCount),
  );

  const scopeASession = await login("review.scope.a@example.com");
  const scopeBSession = await login("review.scope.b@example.com");
  const scopeABSession = await login("review.scope.ab@example.com");
  const scopeEmptySession = await login("review.scope.empty@example.com");
  const scopeACookie = scopeASession.cookie;
  const scopeBCookie = scopeBSession.cookie;
  const scopeABCookie = scopeABSession.cookie;
  const scopeEmptyCookie = scopeEmptySession.cookie;
  t(
    "scoped fixture sessions established",
    Boolean(scopeACookie && scopeBCookie && scopeABCookie && scopeEmptyCookie),
  );

  /* -- assignment admin API -- */

  const userListAsAdmin = await api("GET", "/api/users?limit=50", {
    cookie: superAdmin,
  });
  expectStatus("SA user directory -> 200", userListAsAdmin, 200);
  const userListRows = userListAsAdmin.json?.data ?? [];
  const rowByEmail = (email) => userListRows.find((row) => row.email === email);
  const scopeARow = rowByEmail("review.scope.a@example.com");
  const scopeEmptyRow = rowByEmail("review.scope.empty@example.com");
  const legacyLmRow = rowByEmail("review.labmanager@example.com");
  t(
    "directory serialises explicit scopes and legacy absence distinctly",
    JSON.stringify(scopeARow?.laboratoryIds) === JSON.stringify([labId]) &&
      JSON.stringify(scopeEmptyRow?.laboratoryIds) === "[]" &&
      legacyLmRow?.laboratoryIds === undefined,
    JSON.stringify({
      a: scopeARow?.laboratoryIds,
      empty: scopeEmptyRow?.laboratoryIds,
      legacy: legacyLmRow?.laboratoryIds,
    }),
  );

  const userListStaff = await api("GET", "/api/users?role=STAFF&limit=50", {
    cookie: superAdmin,
  });
  expectStatus("directory role filter -> 200", userListStaff, 200);
  t(
    "role filter returns only that role",
    (userListStaff.json?.data ?? []).length > 0 &&
      (userListStaff.json?.data ?? []).every((row) => row.role === "STAFF"),
    JSON.stringify((userListStaff.json?.data ?? []).map((row) => row.role)),
  );

  const userListByLm = await api("GET", "/api/users?limit=50", {
    cookie: scopeACookie,
  });
  expectStatus("lab manager cannot list platform accounts -> 403", userListByLm, 403);
  const userListAnon = await api("GET", "/api/users?limit=50");
  expectStatus("anonymous user directory -> 401", userListAnon, 401);

  const scopeFlip = await api(
    "PATCH",
    `/api/users/${scopeASession.user.id}/laboratory-scope`,
    { cookie: superAdmin, body: { laboratoryIds: [scopeLab2Id] } },
  );
  expectStatus("assign scope-a to the second laboratory -> 200", scopeFlip, 200);
  t(
    "PATCH returns the replacement scope",
    JSON.stringify(scopeFlip.json?.data?.laboratoryIds) ===
      JSON.stringify([scopeLab2Id]),
    JSON.stringify(scopeFlip.json?.data?.laboratoryIds),
  );

  const userListAfterFlip = await api("GET", "/api/users?limit=50", {
    cookie: superAdmin,
  });
  t(
    "directory reflects the new assignment",
    JSON.stringify(
      (userListAfterFlip.json?.data ?? []).find(
        (row) => row.email === "review.scope.a@example.com",
      )?.laboratoryIds,
    ) === JSON.stringify([scopeLab2Id]),
    JSON.stringify(
      (userListAfterFlip.json?.data ?? []).find(
        (row) => row.email === "review.scope.a@example.com",
      )?.laboratoryIds,
    ),
  );

  const scopeADoc = await mongoose.connection.db
    .collection("users")
    .findOne({ email: "review.scope.a@example.com" });
  const scopeHistory = Array.isArray(scopeADoc?.laboratoryScopeHistory)
    ? scopeADoc.laboratoryScopeHistory
    : [];
  t(
    "the change is recorded in the embedded audit history",
    scopeHistory.length === 1 &&
      JSON.stringify(scopeHistory[0].laboratoryIds) ===
        JSON.stringify([scopeLab2Id]) &&
      JSON.stringify(scopeHistory[0].previousLaboratoryIds) ===
        JSON.stringify([labId]) &&
      typeof scopeHistory[0].changedBy === "string" &&
      scopeHistory[0].changedBy.length > 0 &&
      scopeHistory[0].changedAt != null,
    JSON.stringify(scopeHistory),
  );

  const scopeAbReorder = await api(
    "PATCH",
    `/api/users/${scopeABSession.user.id}/laboratory-scope`,
    { cookie: superAdmin, body: { laboratoryIds: [scopeLab2Id, labId] } },
  );
  expectStatus("reordered identical set -> 200", scopeAbReorder, 200);
  const scopeAbDoc = await mongoose.connection.db
    .collection("users")
    .findOne({ email: "review.scope.ab@example.com" });
  const scopeAbHistory = Array.isArray(scopeAbDoc?.laboratoryScopeHistory)
    ? scopeAbDoc.laboratoryScopeHistory
    : [];
  t(
    "an unchanged set records no history entry",
    scopeAbHistory.length === 0,
    JSON.stringify(scopeAbHistory),
  );

  const scopeBSet = await api(
    "PATCH",
    `/api/users/${scopeBSession.user.id}/laboratory-scope`,
    { cookie: superAdmin, body: { laboratoryIds: [labId] } },
  );
  expectStatus("assign scope-b to the first laboratory -> 200", scopeBSet, 200);

  const scopeDoctorTarget = await api(
    "PATCH",
    `/api/users/${sessions.DOCTOR.user.id}/laboratory-scope`,
    { cookie: superAdmin, body: { laboratoryIds: [labId] } },
  );
  expectStatus("scope on a DOCTOR account -> 400", scopeDoctorTarget, 400);

  const scopeDuplicates = await api(
    "PATCH",
    `/api/users/${scopeEmptySession.user.id}/laboratory-scope`,
    { cookie: superAdmin, body: { laboratoryIds: [labId, labId] } },
  );
  expectStatus("duplicate laboratory ids -> 400", scopeDuplicates, 400);

  const scopeUnknownLab = await api(
    "PATCH",
    `/api/users/${scopeEmptySession.user.id}/laboratory-scope`,
    {
      cookie: superAdmin,
      body: { laboratoryIds: ["507f1f77bcf86cd799439011"] },
    },
  );
  expectStatus("id of a deleted laboratory -> 400", scopeUnknownLab, 400);

  const scopeByLm = await api(
    "PATCH",
    `/api/users/${scopeEmptySession.user.id}/laboratory-scope`,
    { cookie: scopeACookie, body: { laboratoryIds: [labId] } },
  );
  expectStatus("lab manager cannot assign scopes -> 403", scopeByLm, 403);

  const scopeBadBody = await api(
    "PATCH",
    `/api/users/${scopeEmptySession.user.id}/laboratory-scope`,
    { cookie: superAdmin, body: {} },
  );
  expectStatus("missing laboratoryIds -> 400", scopeBadBody, 400);

  /* -- scoped visibility (final states: a=lab2, b=lab1, ab=both, empty=none) -- */

  const queueScopeA = await api("GET", "/api/collection-requests?limit=50", {
    cookie: scopeACookie,
  });
  expectStatus("scope-a queue -> 200", queueScopeA, 200);
  const queueScopeAIds = (queueScopeA.json?.data ?? []).map((row) => row.id);
  t(
    "scope-a sees only the second laboratory's requests",
    queueScopeAIds.includes(scopeLab2BookingId) &&
      !queueScopeAIds.includes(booking1Id),
    JSON.stringify(queueScopeAIds),
  );
  t(
    "scope-a queue total equals the second laboratory's records",
    queueScopeA.json?.meta?.total === scopeLab2DbTotal,
    `scope=${queueScopeA.json?.meta?.total} expected=${scopeLab2DbTotal}`,
  );

  const queueScopeB = await api("GET", "/api/collection-requests?limit=50", {
    cookie: scopeBCookie,
  });
  expectStatus("scope-b queue -> 200", queueScopeB, 200);
  const queueScopeBIds = (queueScopeB.json?.data ?? []).map((row) => row.id);
  t(
    "scope-b sees only the first laboratory's requests",
    queueScopeBIds.includes(booking1Id) &&
      !queueScopeBIds.includes(scopeLab2BookingId),
    JSON.stringify(queueScopeBIds),
  );
  t(
    "scope-b queue total equals the first laboratory's records",
    queueScopeB.json?.meta?.total === scopeLab1DbTotal,
    `scope=${queueScopeB.json?.meta?.total} expected=${scopeLab1DbTotal}`,
  );

  const queueScopeAb = await api("GET", "/api/collection-requests?limit=50", {
    cookie: scopeABCookie,
  });
  expectStatus("scope-ab queue -> 200", queueScopeAb, 200);
  const queueScopeAbIds = (queueScopeAb.json?.data ?? []).map((row) => row.id);
  t(
    "scope-ab sees both laboratories' requests",
    queueScopeAbIds.includes(booking1Id) &&
      queueScopeAbIds.includes(scopeLab2BookingId),
    JSON.stringify(queueScopeAbIds),
  );
  t(
    "scope-ab queue total spans both laboratories",
    queueScopeAb.json?.meta?.total === scopeLab1DbTotal + scopeLab2DbTotal,
    `scope=${queueScopeAb.json?.meta?.total} expected=${scopeLab1DbTotal + scopeLab2DbTotal}`,
  );

  const queueScopeEmpty = await api(
    "GET",
    "/api/collection-requests?limit=50",
    { cookie: scopeEmptyCookie },
  );
  expectStatus("scope-empty queue -> 200", queueScopeEmpty, 200);
  t(
    "scope-empty sees no requests at all",
    queueScopeEmpty.json?.meta?.total === 0 &&
      (queueScopeEmpty.json?.data ?? []).length === 0,
    JSON.stringify(queueScopeEmpty.json?.meta),
  );

  const dirLegacy = await api("GET", "/api/laboratories?limit=50", {
    cookie: labManager,
  });
  expectStatus("legacy platform-wide directory -> 200", dirLegacy, 200);
  const dirLegacyIds = (dirLegacy.json?.data ?? []).map((row) => row.id);
  t(
    "the legacy account still lists both laboratories",
    dirLegacyIds.includes(labId) && dirLegacyIds.includes(scopeLab2Id),
    JSON.stringify(dirLegacyIds),
  );

  const dirScopeA = await api("GET", "/api/laboratories?limit=50", {
    cookie: scopeACookie,
  });
  expectStatus("scope-a directory -> 200", dirScopeA, 200);
  const dirScopeAIds = (dirScopeA.json?.data ?? []).map((row) => row.id);
  t(
    "scope-a directory lists only its laboratory",
    JSON.stringify(dirScopeAIds) === JSON.stringify([scopeLab2Id]),
    JSON.stringify(dirScopeAIds),
  );

  const testsScopeA = await api("GET", "/api/lab-tests?limit=50", {
    cookie: scopeACookie,
  });
  expectStatus("scope-a test catalogue -> 200", testsScopeA, 200);
  const testsScopeAIds = (testsScopeA.json?.data ?? []).map((row) => row.id);
  t(
    "scope-a catalogue contains only its laboratory's tests",
    testsScopeAIds.includes(scopeLab2Test.json?.data?.id) &&
      !testsScopeAIds.includes(testId) &&
      (testsScopeA.json?.data ?? []).every(
        (row) => row.laboratory?.id === scopeLab2Id,
      ),
    JSON.stringify((testsScopeA.json?.data ?? []).map((row) => row.laboratory?.id)),
  );

  const testsScopeAParam = await api(
    "GET",
    `/api/lab-tests?laboratory=${labId}&limit=50`,
    { cookie: scopeACookie },
  );
  expectStatus(
    "out-of-scope laboratory filter intersects to empty -> 200",
    testsScopeAParam,
    200,
  );
  t(
    "an out-of-scope laboratory param returns zero rows",
    testsScopeAParam.json?.meta?.total === 0 &&
      (testsScopeAParam.json?.data ?? []).length === 0,
    JSON.stringify(testsScopeAParam.json?.meta),
  );

  const detailScopeA = await api("GET", `/api/lab-tests/${testId}`, {
    cookie: scopeACookie,
  });
  expectStatus("scope-a detail probe on the other lab's test -> 404", detailScopeA, 404);

  const mutateScopeA = await api("PATCH", `/api/lab-tests/${testId}`, {
    cookie: scopeACookie,
    body: { price: 999 },
  });
  expectStatus("scope-a mutation probe on the other lab's test -> 404", mutateScopeA, 404);

  const testsScopeEmpty = await api("GET", "/api/lab-tests?limit=50", {
    cookie: scopeEmptyCookie,
  });
  expectStatus("scope-empty catalogue -> 200", testsScopeEmpty, 200);
  t(
    "scope-empty catalogue is empty",
    testsScopeEmpty.json?.meta?.total === 0,
    JSON.stringify(testsScopeEmpty.json?.meta),
  );

  const dirDetailScopeA = await api("GET", `/api/laboratories/${labId}`, {
    cookie: scopeACookie,
  });
  expectStatus("scope-a detail probe on the other laboratory -> 404", dirDetailScopeA, 404);

  const dirDeptScopeA = await api(
    "POST",
    `/api/laboratories/${labId}/departments`,
    { cookie: scopeACookie, body: { laboratoryId: labId, name: "X", code: "RW-XX" } },
  );
  expectStatus("scope-a department creation probe -> 404", dirDeptScopeA, 404);

  /* -- admin surface SSR gate -- */

  const usersAnonPage = await page("/admin/users");
  t(
    "anonymous visitor to the assignment page is redirected to login",
    usersAnonPage.status >= 300 && usersAnonPage.status < 400,
    String(usersAnonPage.status),
  );

  const usersAdminPage = await page("/admin/users", superAdmin);
  t(
    "super admin reaches the assignment page",
    usersAdminPage.status === 200 &&
      usersAdminPage.html.includes("Staff Access"),
    String(usersAdminPage.status),
  );

  const usersLmPage = await page("/admin/users", scopeACookie);
  t(
    "a scoped lab manager is redirected away from the admin page",
    usersLmPage.status >= 300 && usersLmPage.status < 400,
    String(usersLmPage.status),
  );

  /* ---------------- [14] doctor/clinic + LIMS CRUD matrix ---------------- */
  console.log("\n[14] doctor/clinic + LIMS CRUD and role matrix");

  const clinicRes = await api("POST", "/api/clinics", {
    cookie: superAdmin,
    body: {
      name: "Review P0C Clinic",
      code: "RW-P0C-CLINIC",
      city: "Pune",
      state: "Maharashtra",
    },
  });
  expectStatus("create clinic -> 201", clinicRes, 201);
  const clinicId = clinicRes.json?.data?.id;
  t("clinic id returned", typeof clinicId === "string" && clinicId.length > 0);

  const clinicDup = await api("POST", "/api/clinics", {
    cookie: superAdmin,
    body: { name: "Duplicate", code: "RW-P0C-CLINIC" },
  });
  expectStatus("duplicate clinic code -> 409", clinicDup, 409);

  const clinicList = await api("GET", "/api/clinics?limit=50", {
    cookie: superAdmin,
  });
  expectStatus("clinic directory -> 200", clinicList, 200);
  t(
    "clinic directory contains the new clinic",
    (clinicList.json?.data ?? []).some((row) => row.id === clinicId),
  );

  const clinicPatch = await api("PATCH", `/api/clinics/${clinicId}`, {
    cookie: superAdmin,
    body: { name: "Review P0C Clinic Renamed" },
  });
  expectStatus("patch clinic name -> 200", clinicPatch, 200);
  t(
    "clinic rename persisted",
    clinicPatch.json?.data?.name === "Review P0C Clinic Renamed",
  );

  const clinicDeactivate = await api("PATCH", `/api/clinics/${clinicId}/status`, {
    cookie: superAdmin,
    body: { isActive: false },
  });
  expectStatus("deactivate clinic -> 200", clinicDeactivate, 200);

  const doctorOnInactive = await api("POST", "/api/doctors", {
    cookie: superAdmin,
    body: {
      clinicId,
      doctorCode: "RW-P0C-DOC-INACTIVE",
      name: "Dr Blocked",
      email: "blocked.p0c@example.com",
      specialization: "Pathology",
    },
  });
  expectStatus(
    "doctor creation on an inactive clinic -> 400",
    doctorOnInactive,
    400,
  );

  const clinicReactivate = await api("PATCH", `/api/clinics/${clinicId}/status`, {
    cookie: superAdmin,
    body: { isActive: true },
  });
  expectStatus("reactivate clinic -> 200", clinicReactivate, 200);

  const clinicPatient = await api("GET", "/api/clinics", {
    cookie: patient1Cookie,
  });
  expectStatus("patient cannot list clinics -> 403", clinicPatient, 403);
  const clinicByLm = await api("GET", "/api/clinics", { cookie: labManager });
  expectStatus("lab manager cannot list clinics -> 403", clinicByLm, 403);
  const clinicCreateByLm = await api("POST", "/api/clinics", {
    cookie: labManager,
    body: { name: "Nope", code: "RW-P0C-NOPE" },
  });
  expectStatus("lab manager cannot create clinics -> 403", clinicCreateByLm, 403);

  const doctorRes = await api("POST", "/api/doctors", {
    cookie: superAdmin,
    body: {
      clinicId,
      doctorCode: "RW-P0C-DOC",
      name: "Dr Review P0C",
      email: "doctor.p0c@example.com",
      specialization: "Internal Medicine",
    },
  });
  expectStatus("create doctor on the active clinic -> 201", doctorRes, 201);
  const p0cDoctorId = doctorRes.json?.data?.id;
  t("doctor id returned", typeof p0cDoctorId === "string" && p0cDoctorId.length > 0);

  const doctorDup = await api("POST", "/api/doctors", {
    cookie: superAdmin,
    body: {
      clinicId,
      doctorCode: "RW-P0C-DOC",
      name: "Dr Duplicate",
      email: "dup.p0c@example.com",
      specialization: "Internal Medicine",
    },
  });
  expectStatus("duplicate doctor code -> 409", doctorDup, 409);

  const doctorNoClinic = await api("POST", "/api/doctors", {
    cookie: superAdmin,
    body: {
      clinicId: "507f1f77bcf86cd799439011",
      doctorCode: "RW-P0C-DOC-404",
      name: "Dr Nowhere",
      email: "nowhere.p0c@example.com",
      specialization: "Internal Medicine",
    },
  });
  expectStatus("doctor creation with unknown clinic -> 404", doctorNoClinic, 404);

  const doctorList = await api("GET", "/api/doctors?limit=50", {
    cookie: superAdmin,
  });
  expectStatus("doctor directory -> 200", doctorList, 200);
  t(
    "doctor directory contains the new doctor",
    (doctorList.json?.data ?? []).some((row) => row.id === p0cDoctorId),
  );

  const doctorSelfList = await api("GET", "/api/doctors?limit=50", {
    cookie: doctor,
  });
  expectStatus("doctor self directory -> 200", doctorSelfList, 200);
  t(
    "doctor self directory hides profiles they do not own",
    (doctorSelfList.json?.data ?? []).every((row) => row.id !== p0cDoctorId) &&
      doctorSelfList.json?.meta?.total === 0,
    JSON.stringify(doctorSelfList.json?.meta),
  );

  const doctorForeign = await api("GET", `/api/doctors/${p0cDoctorId}`, {
    cookie: doctor,
  });
  expectStatus("doctor detail of a foreign profile -> 404", doctorForeign, 404);

  const doctorByPatient = await api("GET", "/api/doctors", {
    cookie: patient1Cookie,
  });
  expectStatus("patient cannot list doctors -> 403", doctorByPatient, 403);

  const doctorPatch = await api("PATCH", `/api/doctors/${p0cDoctorId}`, {
    cookie: superAdmin,
    body: { specialization: "Cardiology" },
  });
  expectStatus("patch doctor specialization -> 200", doctorPatch, 200);
  t(
    "doctor specialization persisted",
    doctorPatch.json?.data?.specialization === "Cardiology",
  );

  const doctorPatchByDoctor = await api("PATCH", `/api/doctors/${p0cDoctorId}`, {
    cookie: doctor,
    body: { specialization: "Hijack" },
  });
  expectStatus("doctor cannot patch foreign profiles -> 403", doctorPatchByDoctor, 403);

  const doctorStatus = await api("PATCH", `/api/doctors/${p0cDoctorId}/status`, {
    cookie: superAdmin,
    body: { isActive: false },
  });
  expectStatus("deactivate doctor -> 200", doctorStatus, 200);
  const doctorStatusBack = await api("PATCH", `/api/doctors/${p0cDoctorId}/status`, {
    cookie: superAdmin,
    body: { isActive: true },
  });
  expectStatus("reactivate doctor -> 200", doctorStatusBack, 200);

  // LIMS CRUD edges: department/test updates + parameter lifecycle.
  const deptId = deptRes.json?.data?.id;
  const deptPatch = await api("PATCH", `/api/lab-departments/${deptId}`, {
    cookie: superAdmin,
    body: { name: "Chemistry Renamed" },
  });
  expectStatus("patch department name -> 200", deptPatch, 200);
  const deptStatus = await api("PATCH", `/api/lab-departments/${deptId}/status`, {
    cookie: superAdmin,
    body: { isActive: false },
  });
  expectStatus("deactivate department -> 200", deptStatus, 200);
  const deptStatusBack = await api("PATCH", `/api/lab-departments/${deptId}/status`, {
    cookie: superAdmin,
    body: { isActive: true },
  });
  expectStatus("reactivate department -> 200", deptStatusBack, 200);

  const testPatch = await api("PATCH", `/api/lab-tests/${testId}`, {
    cookie: superAdmin,
    body: { price: 475 },
  });
  expectStatus("patch test price -> 200", testPatch, 200);
  t("test price persisted", testPatch.json?.data?.price === 475);
  const testStatus = await api("PATCH", `/api/lab-tests/${testId}/status`, {
    cookie: superAdmin,
    body: { isActive: false },
  });
  expectStatus("deactivate test -> 200", testStatus, 200);
  const testStatusBack = await api("PATCH", `/api/lab-tests/${testId}/status`, {
    cookie: superAdmin,
    body: { isActive: true },
  });
  expectStatus("reactivate test -> 200", testStatusBack, 200);

  const paramOne = await api("POST", `/api/lab-tests/${testId}/parameters`, {
    cookie: superAdmin,
    body: {
      labTestId: testId,
      name: "Total Cholesterol",
      code: "RW-TC",
      dataType: "NUMBER",
      unit: "mg/dL",
    },
  });
  expectStatus("create parameter one -> 201", paramOne, 201);
  const paramOneId = paramOne.json?.data?.id;

  const paramTwo = await api("POST", `/api/lab-tests/${testId}/parameters`, {
    cookie: superAdmin,
    body: {
      labTestId: testId,
      name: "HDL Cholesterol",
      code: "RW-HDL",
      dataType: "NUMBER",
      unit: "mg/dL",
    },
  });
  expectStatus("create parameter two -> 201", paramTwo, 201);
  const paramTwoId = paramTwo.json?.data?.id;

  const paramsByPatient = await api("POST", `/api/lab-tests/${testId}/parameters`, {
    cookie: patient1Cookie,
    body: {
      labTestId: testId,
      name: "Hijack",
      code: "RW-HIJACK",
      dataType: "NUMBER",
    },
  });
  expectStatus("patient cannot create parameters -> 403", paramsByPatient, 403);

  const paramsBefore = await api("GET", `/api/lab-tests/${testId}/parameters`, {
    cookie: superAdmin,
  });
  expectStatus("parameter list -> 200", paramsBefore, 200);
  t("two parameters stored", paramsBefore.json?.meta?.total === 2);

  const paramDelete = await api("DELETE", `/api/lab-test-parameters/${paramOneId}`, {
    cookie: superAdmin,
  });
  expectStatus("delete first parameter -> 200", paramDelete, 200);
  t("delete reports deleted: true", paramDelete.json?.data?.deleted === true);

  const paramsAfter = await api("GET", `/api/lab-tests/${testId}/parameters`, {
    cookie: superAdmin,
  });
  expectStatus("parameter list after delete -> 200", paramsAfter, 200);
  t("one parameter remains", paramsAfter.json?.meta?.total === 1);
  t(
    "remaining parameter renumbered to displayOrder 1",
    paramsAfter.json?.data?.[0]?.id === paramTwoId &&
      paramsAfter.json?.data?.[0]?.displayOrder === 1,
    JSON.stringify(paramsAfter.json?.data),
  );

  /* ---------------- [15] staff account provisioning ---------------- */
  console.log("\n[15] staff account provisioning (SA/ADMIN APIs)");

  const usersAsPatient = await api("GET", "/api/users", {
    cookie: patient1Cookie,
  });
  expectStatus("patient cannot list accounts -> 403", usersAsPatient, 403);
  const usersAsLm = await api("GET", "/api/users", { cookie: labManager });
  expectStatus("lab manager cannot list accounts -> 403", usersAsLm, 403);
  const usersAsSa = await api("GET", "/api/users?limit=50", {
    cookie: superAdmin,
  });
  expectStatus("super admin lists accounts -> 200", usersAsSa, 200);

  const lmCreate = await api("POST", "/api/users", {
    cookie: superAdmin,
    body: {
      name: "Provisioned LM",
      email: "provisioned.lm@example.com",
      password: "ProvisionLive!2026",
      confirmPassword: "ProvisionLive!2026",
      role: "LAB_MANAGER",
    },
  });
  expectStatus("create LAB_MANAGER account -> 201", lmCreate, 201);
  const provisionedLmId = lmCreate.json?.data?.id;
  t(
    "new LAB_MANAGER starts explicitly scoped to nothing",
    JSON.stringify(lmCreate.json?.data?.laboratoryIds) === "[]",
    JSON.stringify(lmCreate.json?.data?.laboratoryIds),
  );
  t(
    "create response carries no credential material",
    lmCreate.json?.data?.passwordHash === undefined,
  );

  const staffCreate = await api("POST", "/api/users", {
    cookie: superAdmin,
    body: {
      name: "Provisioned Staff",
      email: "provisioned.staff@example.com",
      password: "ProvisionLive!2026",
      confirmPassword: "ProvisionLive!2026",
      role: "STAFF",
    },
  });
  expectStatus("create STAFF account -> 201", staffCreate, 201);
  t(
    "new STAFF starts explicitly scoped to nothing",
    JSON.stringify(staffCreate.json?.data?.laboratoryIds) === "[]",
  );

  const adminCreate = await api("POST", "/api/users", {
    cookie: superAdmin,
    body: {
      name: "Provisioned Admin",
      email: "provisioned.admin@example.com",
      password: "ProvisionLive!2026",
      confirmPassword: "ProvisionLive!2026",
      role: "ADMIN",
    },
  });
  expectStatus("create ADMIN account -> 201", adminCreate, 201);
  const provisionedAdminId = adminCreate.json?.data?.id;

  // loginWithPassword throws on any non-200, so reaching here means the
  // provisioned admin authenticated successfully.
  const adminSession = await loginWithPassword(
    "provisioned.admin@example.com",
    "ProvisionLive!2026",
  );
  t("provisioned admin can sign in", Boolean(adminSession.cookie));
  const adminCookie = adminSession.cookie;

  const lmDup = await api("POST", "/api/users", {
    cookie: superAdmin,
    body: {
      name: "Duplicate LM",
      email: "provisioned.lm@example.com",
      password: "ProvisionLive!2026",
      confirmPassword: "ProvisionLive!2026",
      role: "LAB_MANAGER",
    },
  });
  expectStatus("duplicate email -> 409", lmDup, 409);

  const roleSuperAdmin = await api("POST", "/api/users", {
    cookie: superAdmin,
    body: {
      name: "Escalate",
      email: "escalate.p0c@example.com",
      password: "ProvisionLive!2026",
      confirmPassword: "ProvisionLive!2026",
      role: "SUPER_ADMIN",
    },
  });
  expectStatus("role SUPER_ADMIN rejected -> 400", roleSuperAdmin, 400);

  const rolePatient = await api("POST", "/api/users", {
    cookie: superAdmin,
    body: {
      name: "Fake Patient",
      email: "fake.patient.p0c@example.com",
      password: "ProvisionLive!2026",
      confirmPassword: "ProvisionLive!2026",
      role: "PATIENT",
    },
  });
  expectStatus("role PATIENT rejected -> 400", rolePatient, 400);

  const weakPassword = await api("POST", "/api/users", {
    cookie: superAdmin,
    body: {
      name: "Weak Password",
      email: "weak.p0c@example.com",
      password: "short",
      confirmPassword: "short",
      role: "STAFF",
    },
  });
  expectStatus("weak password rejected -> 400", weakPassword, 400);

  const createByDoctor = await api("POST", "/api/users", {
    cookie: doctor,
    body: {
      name: "Doctor Attempt",
      email: "doctor.attempt.p0c@example.com",
      password: "ProvisionLive!2026",
      confirmPassword: "ProvisionLive!2026",
      role: "STAFF",
    },
  });
  expectStatus("doctor cannot provision accounts -> 403", createByDoctor, 403);
  const createByLm = await api("POST", "/api/users", {
    cookie: labManager,
    body: {
      name: "LM Attempt",
      email: "lm.attempt.p0c@example.com",
      password: "ProvisionLive!2026",
      confirmPassword: "ProvisionLive!2026",
      role: "STAFF",
    },
  });
  expectStatus("lab manager cannot provision accounts -> 403", createByLm, 403);

  // A freshly provisioned, scoped-to-nothing LAB_MANAGER sees no laboratories.
  const lmSession = await loginWithPassword(
    "provisioned.lm@example.com",
    "ProvisionLive!2026",
  );
  const lmDir = await api("GET", "/api/laboratories?limit=50", {
    cookie: lmSession.cookie,
  });
  expectStatus("provisioned LM directory -> 200", lmDir, 200);
  t(
    "provisioned LM sees zero laboratories until assigned",
    lmDir.json?.meta?.total === 0,
    JSON.stringify(lmDir.json?.meta),
  );

  const lmRename = await api("PATCH", `/api/users/${provisionedLmId}`, {
    cookie: superAdmin,
    body: { name: "Provisioned LM Renamed" },
  });
  expectStatus("rename provisioned LM -> 200", lmRename, 200);
  t(
    "rename persisted",
    lmRename.json?.data?.name === "Provisioned LM Renamed",
  );

  const saSelfPatch = await api("PATCH", `/api/users/${sessions.SUPER_ADMIN.user.id}`, {
    cookie: superAdmin,
    body: { name: "Self Rename Attempt" },
  });
  expectStatus("self-mutation rejected -> 400", saSelfPatch, 400);

  const saTargetByAdmin = await api("PATCH", `/api/users/${sessions.SUPER_ADMIN.user.id}`, {
    cookie: adminCookie,
    body: { name: "Admin Attempts Owner" },
  });
  expectStatus(
    "ADMIN cannot modify a SUPER_ADMIN account -> 403",
    saTargetByAdmin,
    403,
  );

  const lmDeactivate = await api("PATCH", `/api/users/${provisionedLmId}`, {
    cookie: superAdmin,
    body: { isActive: false },
  });
  expectStatus("deactivate provisioned LM -> 200", lmDeactivate, 200);
  t(
    "deactivation persisted",
    lmDeactivate.json?.data?.isActive === false,
  );
  const lmLoginBlocked = await api("POST", "/api/auth/login", {
    body: { email: "provisioned.lm@example.com", password: "ProvisionLive!2026" },
  });
  expectStatus("disabled account cannot sign in -> 403", lmLoginBlocked, 403);

  const lmReactivate = await api("PATCH", `/api/users/${provisionedLmId}`, {
    cookie: adminCookie,
    body: { isActive: true },
  });
  expectStatus(
    "ADMIN can reactivate a lab manager -> 200",
    lmReactivate,
    200,
  );

  // Promoting a PATIENT into STAFF fail-closes their scope (empty array).
  const promotePatient = await api("PATCH", `/api/users/${p1.user.id}`, {
    cookie: superAdmin,
    body: { role: "STAFF" },
  });
  expectStatus("promote PATIENT to STAFF -> 200", promotePatient, 200);
  const promotedDoc = await mongoose.connection.db
    .collection("users")
    .findOne({ _id: new mongoose.Types.ObjectId(p1.user.id) });
  t(
    "promotion into a scoped role writes laboratoryIds []",
    Array.isArray(promotedDoc?.laboratoryIds) &&
      promotedDoc.laboratoryIds.length === 0,
    JSON.stringify(promotedDoc?.laboratoryIds),
  );
  const patchToPatient = await api("PATCH", `/api/users/${p1.user.id}`, {
    cookie: superAdmin,
    body: { role: "PATIENT" },
  });
  expectStatus("PATCH cannot grant PATIENT either -> 400", patchToPatient, 400);
  // PATIENT is not provisionable through the API, so the fixture's original
  // role is restored directly in the throwaway database.
  await mongoose.connection.db.collection("users").updateOne(
    { _id: new mongoose.Types.ObjectId(p1.user.id) },
    { $set: { role: "PATIENT" } },
  );

  const patchRoleEscalation = await api("PATCH", `/api/users/${provisionedAdminId}`, {
    cookie: adminCookie,
    body: { role: "SUPER_ADMIN" },
  });
  expectStatus("PATCH cannot grant SUPER_ADMIN -> 400", patchRoleEscalation, 400);

  const patchEmpty = await api("PATCH", `/api/users/${provisionedAdminId}`, {
    cookie: superAdmin,
    body: {},
  });
  expectStatus("PATCH with an empty body -> 400", patchEmpty, 400);

  /* -- /staff page SSR gate -- */

  const staffPageAnon = await page("/staff");
  t(
    "anonymous visitor to /staff is redirected to login",
    staffPageAnon.status >= 300 && staffPageAnon.status < 400,
    String(staffPageAnon.status),
  );

  const staffPageSa = await page("/staff", superAdmin);
  t(
    "super admin reaches the staff provisioning page",
    staffPageSa.status === 200 && staffPageSa.html.includes("Staff accounts"),
    String(staffPageSa.status),
  );

  const staffPagePatient = await page("/staff", patient1Cookie);
  t(
    "patient is redirected away from /staff",
    staffPagePatient.status >= 300 && staffPagePatient.status < 400,
    String(staffPagePatient.status),
  );

  const staffPageLm = await page("/staff", labManager);
  t(
    "lab manager is redirected away from /staff",
    staffPageLm.status >= 300 && staffPageLm.status < 400,
    String(staffPageLm.status),
  );


  /* ---------------- [16] patient management ---------------- */
  console.log("\n[16] patient management (directory, self-service, guards)");

  const p16DirNoAuth = await api("GET", "/api/patients");
  expectStatus("patient directory without session -> 401", p16DirNoAuth, 401);

  const p16DirPatient = await api("GET", "/api/patients", {
    cookie: patient1Cookie,
  });
  expectStatus("patient cannot browse the directory -> 403", p16DirPatient, 403);

  const p16DirCollector = await api("GET", "/api/patients", {
    cookie: collector1.cookie,
  });
  expectStatus("collector cannot browse the directory -> 403", p16DirCollector, 403);

  const p16DirDoctor = await api("GET", "/api/patients", { cookie: doctor });
  expectStatus("doctor cannot browse the directory -> 403", p16DirDoctor, 403);

  const p16DirLm = await api("GET", "/api/patients?limit=50", {
    cookie: labManager,
  });
  expectStatus("lab manager reaches the directory -> 200", p16DirLm, 200);
  t(
    "directory includes the two legacy patients",
    (p16DirLm.json?.meta?.total ?? 0) >= 2,
    String(p16DirLm.json?.meta?.total),
  );

  const p16DirStaff = await api("GET", "/api/patients?limit=50", {
    cookie: staff,
  });
  expectStatus("staff reaches the directory -> 200", p16DirStaff, 200);

  const p16DirSa = await api("GET", "/api/patients?limit=50", {
    cookie: superAdmin,
  });
  expectStatus("super admin reaches the directory -> 200", p16DirSa, 200);

  // ---- legacy account: synthesized self view, no write on read ----
  const p16SelfLegacy = await api("GET", "/api/patients/me", {
    cookie: patient1Cookie,
  });
  expectStatus("legacy patient self view -> 200", p16SelfLegacy, 200);
  t(
    "legacy self view synthesizes hasProfile:false",
    p16SelfLegacy.json?.data?.profile?.hasProfile === false,
  );
  t(
    "legacy self view exposes no notes key",
    !("notes" in (p16SelfLegacy.json?.data?.profile ?? {})),
  );
  t(
    "legacy self view keeps accountActive true",
    p16SelfLegacy.json?.data?.accountActive === true,
  );

  const p16LegacyCheck = await mongoose.connection.db
    .collection("patientprofiles")
    .countDocuments({ userId: new mongoose.Types.ObjectId(p1.user.id) });
  t("self-view read performed no write (no profile row)", p16LegacyCheck === 0);

  // ---- patient self-upsert + field exclusions ----
  const p16SelfPut = await api("PUT", "/api/patients/me", {
    cookie: patient1Cookie,
    body: { bloodGroup: "O_POS", gender: "FEMALE" },
  });
  expectStatus("patient saves own demographics -> 200", p16SelfPut, 200);
  t(
    "self PUT creates the profile row",
    p16SelfPut.json?.data?.profile?.hasProfile === true,
  );
  t(
    "self PUT persists the blood group",
    p16SelfPut.json?.data?.profile?.bloodGroup === "O_POS",
  );

  const p16SelfNotes = await api("PUT", "/api/patients/me", {
    cookie: patient1Cookie,
    body: { notes: "smuggled" },
  });
  expectStatus("self PUT cannot smuggle notes-only -> 400", p16SelfNotes, 400);

  const p16SelfStatus = await api("PUT", "/api/patients/me", {
    cookie: patient1Cookie,
    body: { isActive: false },
  });
  expectStatus("self PUT cannot smuggle record status -> 400", p16SelfStatus, 400);

  // ---- staff-created patient account ----
  const p16Create = await api("POST", "/api/patients", {
    cookie: superAdmin,
    body: {
      name: "P16 Created Patient",
      email: "p16.new.patient@example.com",
      phone: "+91 9100000199",
      profile: {
        bloodGroup: "A_POS",
        gender: "MALE",
        notes: "Intake note from creation.",
      },
    },
  });
  expectStatus("super admin creates a patient -> 201", p16Create, 201);
  const p16PatientId = p16Create.json?.data?.patient?.id;
  const p16TempPassword = p16Create.json?.data?.temporaryPassword;
  t("created patient id returned", typeof p16PatientId === "string" && p16PatientId.length > 0);
  t(
    "generated temporary password returned once",
    typeof p16TempPassword === "string" && p16TempPassword.length >= 8,
  );
  t(
    "create issues no session cookie",
    !p16Create.headers.get("set-cookie"),
  );
  t(
    "created profile carries the staff note",
    p16Create.json?.data?.patient?.profile?.notes === "Intake note from creation.",
  );

  const p16CreateDup = await api("POST", "/api/patients", {
    cookie: superAdmin,
    body: { name: "Dup", email: "p16.new.patient@example.com" },
  });
  expectStatus("duplicate patient email -> 409", p16CreateDup, 409);

  const p16NewSession = await loginWithPassword(
    "p16.new.patient@example.com",
    p16TempPassword,
  );
  t("created patient signs in with the temporary password", Boolean(p16NewSession.cookie));

  const p16NewSelf = await api("GET", "/api/patients/me", {
    cookie: p16NewSession.cookie,
  });
  expectStatus("created patient self view -> 200", p16NewSelf, 200);
  t(
    "self view excludes staff-only notes even when stored",
    !("notes" in (p16NewSelf.json?.data?.profile ?? {})),
  );

  // ---- directory search + detail authorization ----
  const p16Search = await api(
    "GET",
    "/api/patients?search=p16.new.patient",
    { cookie: staff },
  );
  expectStatus("staff searches the directory -> 200", p16Search, 200);
  t(
    "search finds the created patient by email",
    p16Search.json?.meta?.total === 1 &&
      p16Search.json?.data?.[0]?.id === p16PatientId,
  );

  const p16DetailLm = await api("GET", `/api/patients/${p16PatientId}`, {
    cookie: labManager,
  });
  expectStatus("lab manager reads a patient detail -> 200", p16DetailLm, 200);

  const p16DetailStaff = await api("GET", `/api/patients/${p16PatientId}`, {
    cookie: staff,
  });
  expectStatus("staff reads a patient detail -> 200", p16DetailStaff, 200);

  const p16DetailCollector = await api("GET", `/api/patients/${p16PatientId}`, {
    cookie: collector1.cookie,
  });
  expectStatus("collector cannot read a patient detail -> 403", p16DetailCollector, 403);

  const p16DetailForeign = await api("GET", `/api/patients/${p16PatientId}`, {
    cookie: patient1Cookie,
  });
  expectStatus("patient cannot read another patient -> 403", p16DetailForeign, 403);

  const p16EditLm = await api("PATCH", `/api/patients/${p16PatientId}`, {
    cookie: labManager,
    body: { gender: "OTHER" },
  });
  expectStatus("lab manager cannot edit demographics -> 403", p16EditLm, 403);

  const p16EditStaff = await api("PATCH", `/api/patients/${p16PatientId}`, {
    cookie: staff,
    body: { gender: "OTHER" },
  });
  expectStatus("staff cannot edit demographics -> 403", p16EditStaff, 403);

  // ---- ADMIN session for edit + record-status workflows ----
  const p16AdminCreate = await api("POST", "/api/users", {
    cookie: superAdmin,
    body: {
      name: "P16 Review Admin",
      email: "p16.admin@example.com",
      password: "P16Admin!2026",
      confirmPassword: "P16Admin!2026",
      role: "ADMIN",
    },
  });
  expectStatus("super admin provisions an administrator -> 201", p16AdminCreate, 201);
  const p16Admin = await loginWithPassword("p16.admin@example.com", "P16Admin!2026");
  const p16AdminCookie = p16Admin.cookie;

  const p16AdminPatch = await api("PATCH", `/api/patients/${p16PatientId}`, {
    cookie: p16AdminCookie,
    body: { gender: "OTHER", notes: "Updated intake note." },
  });
  expectStatus("administrator edits demographics + notes -> 200", p16AdminPatch, 200);
  t(
    "administrator edit persists the note",
    p16AdminPatch.json?.data?.profile?.notes === "Updated intake note.",
  );

  const p16EditUnknown = await api(
    "PATCH",
    "/api/patients/507f1f77bcf86cd799439011",
    { cookie: p16AdminCookie, body: { gender: "OTHER" } },
  );
  expectStatus("administrator edit of unknown patient -> 404", p16EditUnknown, 404);

  // ---- record deactivate blocks new bookings + collections ----
  const p16Deactivate = await api("PATCH", `/api/patients/${p16PatientId}/status`, {
    cookie: p16AdminCookie,
    body: { isActive: false },
  });
  expectStatus("administrator deactivates the record -> 200", p16Deactivate, 200);
  t(
    "deactivation flips the record switch",
    p16Deactivate.json?.data?.profile?.isActive === false,
  );

  const p16InactiveList = await api(
    "GET",
    "/api/patients?status=inactive&limit=50",
    { cookie: labManager },
  );
  expectStatus("inactive filter -> 200", p16InactiveList, 200);
  t(
    "inactive filter returns exactly the deactivated patient",
    p16InactiveList.json?.meta?.total === 1 &&
      p16InactiveList.json?.data?.[0]?.id === p16PatientId,
    String(p16InactiveList.json?.meta?.total),
  );

  const p16BookDay = addDays(todayTz(), 2);
  const p16Avail = await api(
    "GET",
    `/api/lab-bookings/availability?laboratoryId=${labId}&date=${p16BookDay}`,
    { cookie: p16NewSession.cookie },
  );
  expectStatus("booking availability for the created patient -> 200", p16Avail, 200);
  const p16Slot = p16Avail.json?.data?.slots?.[0]?.start;
  t("fresh-day slot available", typeof p16Slot === "string", String(p16Slot));

  const p16BlockedBooking = await api("POST", "/api/lab-bookings", {
    cookie: p16NewSession.cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      bookingDate: p16BookDay,
      timeSlot: p16Slot,
      idempotencyKey: "idem-review-p16-blocked-0001",
    },
  });
  expectStatus(
    "deactivated record cannot create a booking -> 403",
    p16BlockedBooking,
    403,
  );

  const p16CollectionAvail = await api(
    "GET",
    `/api/home-collections/availability?laboratoryId=${labId}&date=${p16BookDay}`,
    { cookie: p16NewSession.cookie },
  );
  expectStatus(
    "collection availability for the created patient -> 200",
    p16CollectionAvail,
    200,
  );
  const p16CollectionSlot =
    p16CollectionAvail.json?.data?.slots?.[0]?.start;
  t(
    "fresh-day collection slot available",
    typeof p16CollectionSlot === "string",
    String(p16CollectionSlot),
  );

  const p16BlockedCollection = await api("POST", "/api/home-collections", {
    cookie: p16NewSession.cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      address: {
        recipientName: "P16 Created Patient",
        phone: "+91 9100000199",
        addressLine1: "42 Review Road",
        city: "Pune",
        state: "Maharashtra",
        pincode: "411001",
        latitude: 18.5204,
        longitude: 73.8567,
      },
      scheduledDate: p16BookDay,
      timeSlot: p16CollectionSlot,
      idempotencyKey: "idem-review-p16-coll-blocked-01",
    },
  });
  expectStatus(
    "deactivated record cannot request a collection -> 403",
    p16BlockedCollection,
    403,
  );

  // ---- reactivate: guards lift ----
  const p16Reactivate = await api("PATCH", `/api/patients/${p16PatientId}/status`, {
    cookie: p16AdminCookie,
    body: { isActive: true },
  });
  expectStatus("administrator reactivates the record -> 200", p16Reactivate, 200);

  const p16AllowedBooking = await api("POST", "/api/lab-bookings", {
    cookie: p16NewSession.cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      bookingDate: p16BookDay,
      timeSlot: p16Slot,
      idempotencyKey: "idem-review-p16-allowed-0001",
    },
  });
  expectStatus("reactivated record books again -> 201", p16AllowedBooking, 201);

  const p16AllowedCollection = await api("POST", "/api/home-collections", {
    cookie: p16NewSession.cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      address: {
        recipientName: "P16 Created Patient",
        phone: "+91 9100000199",
        addressLine1: "42 Review Road",
        city: "Pune",
        state: "Maharashtra",
        pincode: "411001",
        latitude: 18.5204,
        longitude: 73.8567,
      },
      scheduledDate: p16BookDay,
      timeSlot: p16CollectionSlot,
      idempotencyKey: "idem-review-p16-coll-allowed-01",
    },
  });
  expectStatus("reactivated record requests a collection -> 201", p16AllowedCollection, 201);

  // ---- legacy account: status toggle upserts the profile row ----
  const p16LegacyDeactivate = await api(
    "PATCH",
    `/api/patients/${p2.user.id}/status`,
    { cookie: p16AdminCookie, body: { isActive: false } },
  );
  expectStatus("deactivating a legacy account upserts a profile -> 200", p16LegacyDeactivate, 200);
  t(
    "legacy deactivate creates the row as inactive",
    p16LegacyDeactivate.json?.data?.profile?.hasProfile === true &&
      p16LegacyDeactivate.json?.data?.profile?.isActive === false,
  );

  const p16LegacyCollectionAvail = await api(
    "GET",
    `/api/home-collections/availability?laboratoryId=${labId}&date=${p16BookDay}`,
    { cookie: patient2Cookie },
  );
  const p16LegacySlot =
    p16LegacyCollectionAvail.json?.data?.slots?.[0]?.start;
  const p16LegacyBlocked = await api("POST", "/api/home-collections", {
    cookie: patient2Cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      address: {
        recipientName: "Review Patient Two",
        phone: "+91 9100000101",
        addressLine1: "7 Legacy Lane",
        city: "Pune",
        state: "Maharashtra",
        pincode: "411002",
        latitude: 18.5204,
        longitude: 73.8567,
      },
      scheduledDate: p16BookDay,
      timeSlot: p16LegacySlot,
      idempotencyKey: "idem-review-p16-legacy-block",
    },
  });
  expectStatus(
    "deactivated legacy record cannot request a collection -> 403",
    p16LegacyBlocked,
    403,
  );

  const p16LegacyReactivate = await api(
    "PATCH",
    `/api/patients/${p2.user.id}/status`,
    { cookie: p16AdminCookie, body: { isActive: true } },
  );
  expectStatus("legacy record reactivates -> 200", p16LegacyReactivate, 200);

  // ---- staff pages ----
  const p16PageSa = await page("/patients", superAdmin);
  t("/patients renders for super admin", p16PageSa.status === 200, String(p16PageSa.status));

  const p16PageLm = await page("/patients", labManager);
  t("/patients renders for lab manager", p16PageLm.status === 200, String(p16PageLm.status));

  const p16PageStaff = await page("/patients", staff);
  t("/patients renders for staff", p16PageStaff.status === 200, String(p16PageStaff.status));

  const p16PagePatient = await page("/patients", patient1Cookie);
  t(
    "patient is redirected away from /patients",
    p16PagePatient.status >= 300 && p16PagePatient.status < 400,
    String(p16PagePatient.status),
  );

  const p16DetailPage = await page(`/patients/${p16PatientId}`, staff);
  t(
    "/patients/[id] renders for staff",
    p16DetailPage.status === 200,
    String(p16DetailPage.status),
  );

  const p16ProfilePage = await page("/profile", patient1Cookie);
  t(
    "/profile renders for patients (health editor is client-fetched)",
    p16ProfilePage.status === 200 &&
      p16ProfilePage.html.includes("My profile"),
    String(p16ProfilePage.status),
  );

  /* ---------------- [17] billing & payment ---------------- */
  console.log("\n[17] billing & payment (internal invoice ledger)");

  // ---- fixtures: two invoiceable bookings + one still pending ----
  const p17Day = addDays(todayTz(), 5);
  const p17Avail = await api(
    "GET",
    `/api/lab-bookings/availability?laboratoryId=${labId}&date=${p17Day}`,
    { cookie: patient1Cookie },
  );
  expectStatus("[17] availability -> 200", p17Avail, 200);
  const p17Slots = p17Avail.json?.data?.slots ?? [];
  const p17Slot1 = p17Slots[0]?.start;
  const p17Slot2 = p17Slots[1]?.start;
  const p17Slot3 = p17Slots[2]?.start;
  t(
    "[17] three slots resolved",
    typeof p17Slot1 === "string" &&
      typeof p17Slot2 === "string" &&
      typeof p17Slot3 === "string",
  );

  const p17BookingA = await api("POST", "/api/lab-bookings", {
    cookie: patient1Cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      bookingDate: p17Day,
      timeSlot: p17Slot1,
      idempotencyKey: "idem-review-p17-bk-a",
    },
  });
  expectStatus("[17] booking A -> 201", p17BookingA, 201);
  const p17BookingAId = p17BookingA.json?.data?.id;
  const p17BookingACode = p17BookingA.json?.data?.bookingCode;
  const p17BookingATotal = p17BookingA.json?.data?.totalAmount;

  const p17BookingB = await api("POST", "/api/lab-bookings", {
    cookie: patient1Cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      bookingDate: p17Day,
      timeSlot: p17Slot2,
      idempotencyKey: "idem-review-p17-bk-b",
    },
  });
  expectStatus("[17] booking B -> 201", p17BookingB, 201);
  const p17BookingBId = p17BookingB.json?.data?.id;

  const p17BookingC = await api("POST", "/api/lab-bookings", {
    cookie: patient1Cookie,
    body: {
      laboratoryId: labId,
      testIds: [testId],
      bookingDate: p17Day,
      timeSlot: p17Slot3,
      idempotencyKey: "idem-review-p17-bk-c",
    },
  });
  expectStatus("[17] booking C (pending) -> 201", p17BookingC, 201);
  const p17BookingCId = p17BookingC.json?.data?.id;

  const p17ApproveA = await api(
    "PATCH",
    `/api/lab-bookings/${p17BookingAId}/status`,
    { cookie: labManager, body: { status: "CONFIRMED" } },
  );
  expectStatus("[17] approve booking A -> 200", p17ApproveA, 200);
  const p17ApproveB = await api(
    "PATCH",
    `/api/lab-bookings/${p17BookingBId}/status`,
    { cookie: labManager, body: { status: "CONFIRMED" } },
  );
  expectStatus("[17] approve booking B -> 200", p17ApproveB, 200);

  // ---- invoice creation from source snapshots ----
  const p17InvAPost = await api("POST", "/api/invoices", {
    cookie: labManager,
    body: {
      sourceType: "BOOKING",
      sourceId: p17BookingAId,
      notes: "review billing notes",
    },
  });
  expectStatus("[17] invoice from booking A -> 201", p17InvAPost, 201);
  const p17InvA = p17InvAPost.json?.data;
  t(
    "[17] invoice code matches INV-YYYY-NNNNNN",
    /^INV-\d{4}-\d{6}$/.test(p17InvA?.invoiceCode ?? ""),
    p17InvA?.invoiceCode,
  );
  t(
    "[17] invoice starts as DRAFT with a zero balance",
    p17InvA?.status === "DRAFT" &&
      p17InvA?.netPaid === 0 &&
      p17InvA?.balance === p17InvA?.totalAmount,
    JSON.stringify({
      status: p17InvA?.status,
      netPaid: p17InvA?.netPaid,
      balance: p17InvA?.balance,
    }),
  );
  t(
    "[17] invoice totals copy the booking snapshot",
    p17InvA?.totalAmount === p17BookingATotal &&
      (p17InvA?.items ?? []).length === 1,
    `${p17InvA?.totalAmount} vs booking ${p17BookingATotal}`,
  );
  t(
    "[17] invoice carries patient, laboratory and source code",
    p17InvA?.patientId === p1.user.id &&
      p17InvA?.laboratory?.id === labId &&
      p17InvA?.sourceCode === p17BookingACode,
    JSON.stringify({
      patient: p17InvA?.patientId,
      lab: p17InvA?.laboratory?.id,
      source: p17InvA?.sourceCode,
    }),
  );
  t("[17] invoice stores the staff note", p17InvA?.notes === "review billing notes");
  const p17InvAId = p17InvA?.id;

  const p17Dup = await api("POST", "/api/invoices", {
    cookie: labManager,
    body: { sourceType: "BOOKING", sourceId: p17BookingAId },
  });
  expectStatus("[17] duplicate source invoice -> 409", p17Dup, 409);

  const p17Pending = await api("POST", "/api/invoices", {
    cookie: labManager,
    body: { sourceType: "BOOKING", sourceId: p17BookingCId },
  });
  expectStatus("[17] pending booking cannot be invoiced -> 400", p17Pending, 400);

  const p17PatientPost = await api("POST", "/api/invoices", {
    cookie: patient1Cookie,
    body: { sourceType: "BOOKING", sourceId: p17BookingCId },
  });
  expectStatus("[17] patient cannot create invoices -> 403", p17PatientPost, 403);

  const p17DoctorPost = await api("POST", "/api/invoices", {
    cookie: doctor,
    body: { sourceType: "BOOKING", sourceId: p17BookingCId },
  });
  expectStatus("[17] doctor cannot create invoices -> 403", p17DoctorPost, 403);

  // ---- idempotent creation ----
  const p17Idem1 = await api("POST", "/api/invoices", {
    cookie: labManager,
    body: {
      sourceType: "BOOKING",
      sourceId: p17BookingBId,
      idempotencyKey: "idem-review-p17-inv-1",
    },
  });
  expectStatus("[17] idempotent invoice create -> 201", p17Idem1, 201);
  const p17InvBId = p17Idem1.json?.data?.id;

  const p17Idem2 = await api("POST", "/api/invoices", {
    cookie: labManager,
    body: {
      sourceType: "BOOKING",
      sourceId: p17BookingBId,
      idempotencyKey: "idem-review-p17-inv-1",
    },
  });
  expectStatus("[17] idempotent replay -> 200", p17Idem2, 200);
  t(
    "[17] idempotent replay returns the original invoice",
    p17Idem2.json?.data?.id === p17InvBId,
    `${p17Idem2.json?.data?.id} vs ${p17InvBId}`,
  );

  const p17Idem3 = await api("POST", "/api/invoices", {
    cookie: labManager,
    body: { sourceType: "BOOKING", sourceId: p17BookingBId },
  });
  expectStatus("[17] third create without key -> 409", p17Idem3, 409);

  // ---- DRAFT rules on invoice B ----
  const p17DraftPay = await api(
    "POST",
    `/api/invoices/${p17InvBId}/payments`,
    { cookie: labManager, body: { kind: "PAYMENT", amount: 10, method: "CASH" } },
  );
  expectStatus("[17] payment against DRAFT -> 400", p17DraftPay, 400);

  const p17InvBEdit = await api("PATCH", `/api/invoices/${p17InvBId}`, {
    cookie: labManager,
    body: {
      items: [
        { description: "Adjusted test", unitPrice: 475.5, quantity: 2 },
      ],
    },
  });
  expectStatus("[17] DRAFT item edit -> 200", p17InvBEdit, 200);
  t(
    "[17] DRAFT edit recomputes totals server-side",
    p17InvBEdit.json?.data?.totalAmount === 951 &&
      p17InvBEdit.json?.data?.subtotal === 951 &&
      p17InvBEdit.json?.data?.items?.[0]?.lineTotal === 951,
    JSON.stringify({
      total: p17InvBEdit.json?.data?.totalAmount,
      subtotal: p17InvBEdit.json?.data?.subtotal,
    }),
  );
  const p17InvBTotal = p17InvBEdit.json?.data?.totalAmount;

  // ---- issue invoice A ----
  const p17IssueA = await api("PATCH", `/api/invoices/${p17InvAId}`, {
    cookie: labManager,
    body: { status: "ISSUED" },
  });
  expectStatus("[17] issue invoice A -> 200", p17IssueA, 200);
  t("[17] invoice A is ISSUED", p17IssueA.json?.data?.status === "ISSUED");

  const p17IssueAgain = await api("PATCH", `/api/invoices/${p17InvAId}`, {
    cookie: labManager,
    body: { status: "ISSUED" },
  });
  expectStatus("[17] double issue -> 400", p17IssueAgain, 400);

  const p17EditIssued = await api("PATCH", `/api/invoices/${p17InvAId}`, {
    cookie: labManager,
    body: { notes: "sneaky edit" },
  });
  expectStatus("[17] editing an issued invoice -> 400", p17EditIssued, 400);

  // ---- payment lifecycle on invoice A ----
  const p17Pay100 = await api(
    "POST",
    `/api/invoices/${p17InvAId}/payments`,
    {
      cookie: labManager,
      body: {
        kind: "PAYMENT",
        amount: 100,
        method: "UPI",
        reference: "RCP-P17-1",
        note: "counter receipt",
      },
    },
  );
  expectStatus("[17] partial payment -> 201", p17Pay100, 201);
  t(
    "[17] balance drops while status stays ISSUED",
    p17Pay100.json?.data?.balance === p17BookingATotal - 100 &&
      p17Pay100.json?.data?.netPaid === 100 &&
      p17Pay100.json?.data?.status === "ISSUED",
    JSON.stringify({
      balance: p17Pay100.json?.data?.balance,
      status: p17Pay100.json?.data?.status,
    }),
  );

  const p17Overpay = await api(
    "POST",
    `/api/invoices/${p17InvAId}/payments`,
    {
      cookie: labManager,
      body: { kind: "PAYMENT", amount: p17BookingATotal * 2, method: "CASH" },
    },
  );
  expectStatus("[17] overpayment rejected -> 400", p17Overpay, 400);
  t(
    "[17] overpayment message names the balance",
    String(p17Overpay.json?.error ?? "").includes("outstanding balance"),
    JSON.stringify(p17Overpay.json),
  );

  const p17RefundIssued = await api(
    "POST",
    `/api/invoices/${p17InvAId}/payments`,
    { cookie: labManager, body: { kind: "REFUND", amount: 10, method: "CASH" } },
  );
  expectStatus("[17] refund before PAID -> 400", p17RefundIssued, 400);

  const p17PayRest = await api(
    "POST",
    `/api/invoices/${p17InvAId}/payments`,
    {
      cookie: labManager,
      body: {
        kind: "PAYMENT",
        amount: p17BookingATotal - 100,
        method: "CASH",
      },
    },
  );
  expectStatus("[17] settle invoice A -> 201", p17PayRest, 201);
  t(
    "[17] zero balance auto-settles to PAID",
    p17PayRest.json?.data?.status === "PAID" &&
      p17PayRest.json?.data?.balance === 0 &&
      p17PayRest.json?.data?.netPaid === p17BookingATotal,
    JSON.stringify({
      status: p17PayRest.json?.data?.status,
      balance: p17PayRest.json?.data?.balance,
    }),
  );

  const p17Refund100 = await api(
    "POST",
    `/api/invoices/${p17InvAId}/payments`,
    { cookie: labManager, body: { kind: "REFUND", amount: 100, method: "CASH" } },
  );
  expectStatus("[17] partial refund -> 201", p17Refund100, 201);
  t(
    "[17] partial refund keeps PAID with a new balance",
    p17Refund100.json?.data?.status === "PAID" &&
      p17Refund100.json?.data?.balance === 100 &&
      p17Refund100.json?.data?.netPaid === p17BookingATotal - 100,
    JSON.stringify({
      status: p17Refund100.json?.data?.status,
      balance: p17Refund100.json?.data?.balance,
    }),
  );

  const p17RefundTooMuch = await api(
    "POST",
    `/api/invoices/${p17InvAId}/payments`,
    {
      cookie: labManager,
      body: { kind: "REFUND", amount: p17BookingATotal, method: "CASH" },
    },
  );
  expectStatus("[17] refund above net paid -> 400", p17RefundTooMuch, 400);

  const p17RefundRest = await api(
    "POST",
    `/api/invoices/${p17InvAId}/payments`,
    {
      cookie: labManager,
      body: {
        kind: "REFUND",
        amount: p17BookingATotal - 100,
        method: "CASH",
      },
    },
  );
  expectStatus("[17] full refund -> 201", p17RefundRest, 201);
  t(
    "[17] full refund reverts PAID to ISSUED",
    p17RefundRest.json?.data?.status === "ISSUED" &&
      p17RefundRest.json?.data?.netPaid === 0 &&
      p17RefundRest.json?.data?.balance === p17BookingATotal,
    JSON.stringify({
      status: p17RefundRest.json?.data?.status,
      netPaid: p17RefundRest.json?.data?.netPaid,
    }),
  );

  const p17PayAgain = await api(
    "POST",
    `/api/invoices/${p17InvAId}/payments`,
    {
      cookie: labManager,
      body: {
        kind: "PAYMENT",
        amount: p17BookingATotal,
        method: "BANK_TRANSFER",
      },
    },
  );
  expectStatus("[17] re-pay after reversion -> 201", p17PayAgain, 201);
  t(
    "[17] invoice settles again",
    p17PayAgain.json?.data?.status === "PAID",
    p17PayAgain.json?.data?.status,
  );

  const p17VoidPaid = await api("PATCH", `/api/invoices/${p17InvAId}`, {
    cookie: labManager,
    body: { status: "VOID", voidReason: "attempt while paid" },
  });
  expectStatus("[17] void a PAID invoice -> 400", p17VoidPaid, 400);
  t(
    "[17] refunds-first message returned",
    String(p17VoidPaid.json?.error ?? "").includes("refunds"),
    JSON.stringify(p17VoidPaid.json),
  );

  const p17RefundFull = await api(
    "POST",
    `/api/invoices/${p17InvAId}/payments`,
    {
      cookie: labManager,
      body: { kind: "REFUND", amount: p17BookingATotal, method: "CARD" },
    },
  );
  expectStatus("[17] final full refund -> 201", p17RefundFull, 201);
  t(
    "[17] invoice back to ISSUED after full refund",
    p17RefundFull.json?.data?.status === "ISSUED",
    p17RefundFull.json?.data?.status,
  );

  const p17VoidA = await api("PATCH", `/api/invoices/${p17InvAId}`, {
    cookie: labManager,
    body: { status: "VOID", voidReason: "billing review void" },
  });
  expectStatus("[17] void unpaid ISSUED invoice -> 200", p17VoidA, 200);
  t(
    "[17] void stores the reason",
    p17VoidA.json?.data?.status === "VOID" &&
      p17VoidA.json?.data?.voidReason === "billing review void",
    JSON.stringify({
      status: p17VoidA.json?.data?.status,
      reason: p17VoidA.json?.data?.voidReason,
    }),
  );

  const p17Recreate = await api("POST", "/api/invoices", {
    cookie: labManager,
    body: { sourceType: "BOOKING", sourceId: p17BookingAId },
  });
  expectStatus("[17] source reusable after VOID -> 201", p17Recreate, 201);
  const p17InvA2Id = p17Recreate.json?.data?.id;

  const p17VoidNoReason = await api("PATCH", `/api/invoices/${p17InvA2Id}`, {
    cookie: labManager,
    body: { status: "VOID" },
  });
  expectStatus("[17] VOID without a reason -> 400", p17VoidNoReason, 400);

  const p17VoidA2 = await api("PATCH", `/api/invoices/${p17InvA2Id}`, {
    cookie: labManager,
    body: { status: "VOID", voidReason: "cleanup after review" },
  });
  expectStatus("[17] DRAFT void with reason -> 200", p17VoidA2, 200);

  // ---- invoice B: concurrency + terminal transitions ----
  const p17IssueB = await api("PATCH", `/api/invoices/${p17InvBId}`, {
    cookie: labManager,
    body: { status: "ISSUED" },
  });
  expectStatus("[17] issue invoice B -> 200", p17IssueB, 200);

  const p17Race = await Promise.all([
    api("POST", `/api/invoices/${p17InvBId}/payments`, {
      cookie: labManager,
      body: { kind: "PAYMENT", amount: p17InvBTotal, method: "CASH" },
    }),
    api("POST", `/api/invoices/${p17InvBId}/payments`, {
      cookie: staff,
      body: { kind: "PAYMENT", amount: p17InvBTotal, method: "UPI" },
    }),
  ]);
  const p17RaceStatuses = p17Race.map((res) => res.status).sort((a, b) => a - b);
  t(
    "[17] racing full payments settle exactly once",
    p17RaceStatuses[0] === 201 && p17RaceStatuses[1] === 400,
    JSON.stringify(p17RaceStatuses),
  );

  const p17GetB = await api("GET", `/api/invoices/${p17InvBId}`, {
    cookie: labManager,
  });
  expectStatus("[17] invoice B detail -> 200", p17GetB, 200);
  t(
    "[17] exactly one payment landed; balance zero",
    p17GetB.json?.data?.balance === 0 &&
      p17GetB.json?.data?.netPaid === p17InvBTotal &&
      (p17GetB.json?.data?.payments ?? []).length === 1 &&
      p17GetB.json?.data?.status === "PAID",
    JSON.stringify({
      balance: p17GetB.json?.data?.balance,
      payments: (p17GetB.json?.data?.payments ?? []).length,
      status: p17GetB.json?.data?.status,
    }),
  );

  t(
    "[17] events carry actor names, not bare ids only",
    (p17GetB.json?.data?.events ?? []).every(
      (event) => typeof event.actorId === "string" && event.actorName,
    ),
  );

  const p17IssueOnPaid = await api("PATCH", `/api/invoices/${p17InvBId}`, {
    cookie: labManager,
    body: { status: "ISSUED" },
  });
  expectStatus("[17] issue a PAID invoice -> 400", p17IssueOnPaid, 400);

  const p17EditOnPaid = await api("PATCH", `/api/invoices/${p17InvBId}`, {
    cookie: labManager,
    body: { notes: "edit attempt" },
  });
  expectStatus("[17] edit a PAID invoice -> 400", p17EditOnPaid, 400);

  const p17VoidOnPaid = await api("PATCH", `/api/invoices/${p17InvBId}`, {
    cookie: labManager,
    body: { status: "VOID", voidReason: "direct void attempt" },
  });
  expectStatus("[17] void invoice B while PAID -> 400", p17VoidOnPaid, 400);

  const p17RefundB = await api(
    "POST",
    `/api/invoices/${p17InvBId}/payments`,
    {
      cookie: staff,
      body: { kind: "REFUND", amount: p17InvBTotal, method: "CARD" },
    },
  );
  expectStatus("[17] full refund on B -> 201", p17RefundB, 201);
  t(
    "[17] invoice B reverts to ISSUED",
    p17RefundB.json?.data?.status === "ISSUED",
    p17RefundB.json?.data?.status,
  );

  const p17VoidB = await api("PATCH", `/api/invoices/${p17InvBId}`, {
    cookie: labManager,
    body: { status: "VOID", voidReason: "review complete" },
  });
  expectStatus("[17] void invoice B -> 200", p17VoidB, 200);

  const p17GetBFinal = await api("GET", `/api/invoices/${p17InvBId}`, {
    cookie: labManager,
  });
  expectStatus("[17] invoice B detail after void -> 200", p17GetBFinal, 200);
  const p17FinalBActions = new Set(
    (p17GetBFinal.json?.data?.events ?? []).map((event) => event.action),
  );
  t(
    "[17] audit timeline covers the full lifecycle",
    [
      "INVOICE_CREATED",
      "INVOICE_ISSUED",
      "PAYMENT_RECORDED",
      "INVOICE_SETTLED",
      "REFUND_RECORDED",
      "INVOICE_REVERTED",
      "INVOICE_VOIDED",
    ].every((action) => p17FinalBActions.has(action)),
    JSON.stringify([...p17FinalBActions]),
  );

  // ---- manual invoices + zero-total settlement ----
  const p17Manual = await api("POST", "/api/invoices", {
    cookie: superAdmin,
    body: {
      sourceType: "MANUAL",
      patientId: p2.user.id,
      laboratoryId: labId,
      items: [
        { description: "Home visit fee", unitPrice: 150, quantity: 1 },
        { description: "Sample handling", unitPrice: 50.5, quantity: 3 },
      ],
    },
  });
  expectStatus("[17] manual invoice -> 201", p17Manual, 201);
  const p17ManualId = p17Manual.json?.data?.id;
  t(
    "[17] manual totals computed server-side",
    p17Manual.json?.data?.totalAmount === 301.5 &&
      p17Manual.json?.data?.subtotal === 301.5 &&
      (p17Manual.json?.data?.items ?? []).length === 2,
    String(p17Manual.json?.data?.totalAmount),
  );
  t(
    "[17] manual invoice targets the requested patient",
    p17Manual.json?.data?.patientId === p2.user.id,
    p17Manual.json?.data?.patientId,
  );

  const p17ManualBadPatient = await api("POST", "/api/invoices", {
    cookie: superAdmin,
    body: {
      sourceType: "MANUAL",
      patientId: "64b000000000000000000000",
      laboratoryId: labId,
      items: [{ description: "Ghost", unitPrice: 10, quantity: 1 }],
    },
  });
  expectStatus("[17] manual invoice for unknown patient -> 404", p17ManualBadPatient, 404);

  const p17ManualBadTest = await api("POST", "/api/invoices", {
    cookie: superAdmin,
    body: {
      sourceType: "MANUAL",
      patientId: p2.user.id,
      laboratoryId: labId,
      items: [
        {
          labTestId: scopeLab2Test.json?.data?.id,
          description: "Foreign test",
          unitPrice: 100,
          quantity: 1,
        },
      ],
    },
  });
  expectStatus("[17] foreign-catalogue item rejected -> 400", p17ManualBadTest, 400);

  const p17Zero = await api("POST", "/api/invoices", {
    cookie: superAdmin,
    body: {
      sourceType: "MANUAL",
      patientId: p2.user.id,
      laboratoryId: labId,
      items: [{ description: "Adjustment", unitPrice: 0, quantity: 1 }],
    },
  });
  expectStatus("[17] zero-total invoice -> 201", p17Zero, 201);
  const p17ZeroIssue = await api("PATCH", `/api/invoices/${p17Zero.json?.data?.id}`, {
    cookie: superAdmin,
    body: { status: "ISSUED" },
  });
  expectStatus("[17] issue zero-total invoice -> 200", p17ZeroIssue, 200);
  t(
    "[17] zero-total invoice settles immediately",
    p17ZeroIssue.json?.data?.status === "PAID",
    p17ZeroIssue.json?.data?.status,
  );

  // ---- cross-laboratory scoping ----
  const p17ScopedLmCreate = await api("POST", "/api/users", {
    cookie: superAdmin,
    body: {
      name: "Review Billing LM",
      email: "review.billing.lm@example.com",
      password: PASSWORD,
      confirmPassword: PASSWORD,
      role: "LAB_MANAGER",
    },
  });
  expectStatus("[17] scoped lab manager provisioned -> 201", p17ScopedLmCreate, 201);
  t(
    "[17] new lab manager starts scoped to nothing",
    JSON.stringify(p17ScopedLmCreate.json?.data?.laboratoryIds) === "[]",
    JSON.stringify(p17ScopedLmCreate.json?.data?.laboratoryIds),
  );
  const p17ScopeAssign = await api(
    "PATCH",
    `/api/users/${p17ScopedLmCreate.json?.data?.id}/laboratory-scope`,
    { cookie: superAdmin, body: { laboratoryIds: [scopeLab2Id] } },
  );
  expectStatus(
    "[17] assign the lab manager to the second laboratory -> 200",
    p17ScopeAssign,
    200,
  );
  t(
    "[17] scope assignment returns the second laboratory",
    JSON.stringify(p17ScopeAssign.json?.data?.laboratoryIds) ===
      JSON.stringify([scopeLab2Id]),
    JSON.stringify(p17ScopeAssign.json?.data?.laboratoryIds),
  );
  const p17Scoped = await loginWithPassword(
    "review.billing.lm@example.com",
    PASSWORD,
  );

  const p17CrossGet = await api("GET", `/api/invoices/${p17ManualId}`, {
    cookie: p17Scoped.cookie,
  });
  expectStatus("[17] cross-lab invoice read -> 404", p17CrossGet, 404);

  const p17CrossPatch = await api("PATCH", `/api/invoices/${p17ManualId}`, {
    cookie: p17Scoped.cookie,
    body: { notes: "cross-lab edit" },
  });
  expectStatus("[17] cross-lab invoice edit -> 404", p17CrossPatch, 404);

  const p17CrossPay = await api(
    "POST",
    `/api/invoices/${p17ManualId}/payments`,
    { cookie: p17Scoped.cookie, body: { kind: "PAYMENT", amount: 5, method: "CASH" } },
  );
  expectStatus("[17] cross-lab payment -> 404", p17CrossPay, 404);

  const p17Lab2Avail = await api(
    "GET",
    `/api/lab-bookings/availability?laboratoryId=${scopeLab2Id}&date=${p17Day}`,
    { cookie: patient1Cookie },
  );
  expectStatus("[17] second-lab availability -> 200", p17Lab2Avail, 200);
  const p17Lab2Slot = p17Lab2Avail.json?.data?.slots?.[0]?.start;
  const p17Lab2Booking = await api("POST", "/api/lab-bookings", {
    cookie: patient1Cookie,
    body: {
      laboratoryId: scopeLab2Id,
      testIds: [scopeLab2Test.json?.data?.id],
      bookingDate: p17Day,
      timeSlot: p17Lab2Slot,
      idempotencyKey: "idem-review-p17-lab2",
    },
  });
  expectStatus("[17] booking at second lab -> 201", p17Lab2Booking, 201);
  const p17Lab2Approve = await api(
    "PATCH",
    `/api/lab-bookings/${p17Lab2Booking.json?.data?.id}/status`,
    { cookie: p17Scoped.cookie, body: { status: "CONFIRMED" } },
  );
  expectStatus("[17] scoped LM approves own-lab booking -> 200", p17Lab2Approve, 200);

  const p17ScopedInvoice = await api("POST", "/api/invoices", {
    cookie: p17Scoped.cookie,
    body: {
      sourceType: "BOOKING",
      sourceId: p17Lab2Booking.json?.data?.id,
    },
  });
  expectStatus("[17] scoped LM invoices own lab -> 201", p17ScopedInvoice, 201);

  const p17ScopedCrossSource = await api("POST", "/api/invoices", {
    cookie: p17Scoped.cookie,
    body: { sourceType: "BOOKING", sourceId: p17BookingCId },
  });
  expectStatus("[17] scoped LM cannot invoice a foreign booking -> 404", p17ScopedCrossSource, 404);

  const p17ScopedList = await api("GET", "/api/invoices?limit=50", {
    cookie: p17Scoped.cookie,
  });
  expectStatus("[17] scoped invoice list -> 200", p17ScopedList, 200);
  const p17ScopedRows = p17ScopedList.json?.data ?? [];
  t(
    "[17] scoped list contains only own-laboratory invoices",
    p17ScopedRows.length > 0 &&
      p17ScopedRows.every((row) => row.laboratory?.id === scopeLab2Id),
    JSON.stringify(p17ScopedRows.map((row) => row.laboratory?.id)),
  );

  const p17WideList = await api("GET", "/api/invoices?limit=50", {
    cookie: labManager,
  });
  expectStatus("[17] platform-wide list -> 200", p17WideList, 200);
  t(
    "[17] legacy platform-wide LM sees every laboratory",
    (p17WideList.json?.data ?? []).some((row) => row.laboratory?.id === labId) &&
      (p17WideList.json?.data ?? []).some(
        (row) => row.laboratory?.id === scopeLab2Id,
      ),
  );

  // ---- patient surfaces ----
  const p17PatientList = await api("GET", "/api/invoices?limit=50", {
    cookie: patient1Cookie,
  });
  expectStatus("[17] patient invoice list -> 200", p17PatientList, 200);
  const p17PatientRows = p17PatientList.json?.data ?? [];
  t(
    "[17] patient list is own-only",
    p17PatientRows.length > 0 &&
      p17PatientRows.every((row) => row.patientId === p1.user.id),
    String(p17PatientRows.length),
  );
  t(
    "[17] patient list rows carry no internal keys",
    p17PatientRows.every(
      (row) =>
        !("notes" in row) &&
        !("voidReason" in row) &&
        !("createdBy" in row) &&
        row.payments.every(
          (payment) => !("note" in payment) && !("receivedBy" in payment),
        ),
    ),
  );

  const p17Patient2List = await api("GET", "/api/invoices?limit=50", {
    cookie: patient2Cookie,
  });
  expectStatus("[17] patient2 invoice list -> 200", p17Patient2List, 200);
  t(
    "[17] patient2 never sees patient1 invoices",
    (p17Patient2List.json?.data ?? []).every(
      (row) => row.id !== p17InvA2Id && row.id !== p17InvBId,
    ),
  );

  const p17OwnerDetail = await api("GET", `/api/invoices/${p17InvA2Id}`, {
    cookie: patient1Cookie,
  });
  expectStatus("[17] owner reads own invoice -> 200", p17OwnerDetail, 200);
  t(
    "[17] owner payload omits internal keys",
    !("notes" in (p17OwnerDetail.json?.data ?? {})) &&
      !("voidReason" in (p17OwnerDetail.json?.data ?? {})) &&
      !("createdBy" in (p17OwnerDetail.json?.data ?? {})) &&
      !("events" in (p17OwnerDetail.json?.data ?? {})),
    JSON.stringify(Object.keys(p17OwnerDetail.json?.data ?? {})),
  );

  const p17StrangerDetail = await api("GET", `/api/invoices/${p17InvA2Id}`, {
    cookie: patient2Cookie,
  });
  expectStatus("[17] non-owner invoice read -> 404", p17StrangerDetail, 404);

  const p17StaffDetail = await api("GET", `/api/invoices/${p17ManualId}`, {
    cookie: staff,
  });
  expectStatus("[17] staff invoice detail -> 200", p17StaffDetail, 200);
  t(
    "[17] staff payload carries internal keys + timeline",
    "notes" in (p17StaffDetail.json?.data ?? {}) &&
      "createdBy" in (p17StaffDetail.json?.data ?? {}) &&
      Array.isArray(p17StaffDetail.json?.data?.events),
    JSON.stringify(Object.keys(p17StaffDetail.json?.data ?? {})),
  );

  const p17CollectorList = await api("GET", "/api/invoices", {
    cookie: collector1.cookie,
  });
  expectStatus("[17] collector invoice list -> 403", p17CollectorList, 403);

  const p17DoctorList = await api("GET", "/api/invoices", { cookie: doctor });
  expectStatus("[17] doctor invoice list -> 403", p17DoctorList, 403);

  // ---- list filters ----
  const p17VoidFilter = await api(
    "GET",
    `/api/invoices?status=VOID&limit=50`,
    { cookie: labManager },
  );
  expectStatus("[17] VOID filter -> 200", p17VoidFilter, 200);
  t(
    "[17] VOID filter returns the voided invoice",
    (p17VoidFilter.json?.data ?? []).some((row) => row.id === p17InvA2Id),
  );

  const p17Search = await api(
    "GET",
    `/api/invoices?search=${p17Recreate.json?.data?.invoiceCode}&limit=50`,
    { cookie: labManager },
  );
  expectStatus("[17] code search -> 200", p17Search, 200);
  t(
    "[17] code search matches exactly one invoice",
    (p17Search.json?.data ?? []).length === 1 &&
      p17Search.json?.data?.[0]?.id === p17InvA2Id,
    String((p17Search.json?.data ?? []).length),
  );

  const p17ManualFilter = await api(
    "GET",
    "/api/invoices?sourceType=MANUAL&limit=50",
    { cookie: superAdmin },
  );
  expectStatus("[17] MANUAL source filter -> 200", p17ManualFilter, 200);
  t(
    "[17] MANUAL filter returns the manual invoice",
    (p17ManualFilter.json?.data ?? []).some((row) => row.id === p17ManualId),
  );

  const p17SourceFilter = await api(
    "GET",
    `/api/invoices?sourceId=${p17BookingAId}&limit=50`,
    { cookie: patient1Cookie },
  );
  expectStatus("[17] patient source filter -> 200", p17SourceFilter, 200);
  t(
    "[17] source filter returns every invoice of that booking",
    (p17SourceFilter.json?.data ?? []).length >= 2 &&
      (p17SourceFilter.json?.data ?? []).every(
        (row) => row.sourceId === p17BookingAId,
      ),
    String((p17SourceFilter.json?.data ?? []).length),
  );

  // ---- pages ----
  const p17PageLm = await page("/billing", labManager);
  t("[17] /billing renders for lab manager", p17PageLm.status === 200, String(p17PageLm.status));

  const p17PageStaff = await page("/billing", staff);
  t("[17] /billing renders for staff", p17PageStaff.status === 200, String(p17PageStaff.status));

  const p17PagePatient = await page("/billing", patient1Cookie);
  t(
    "[17] patient is redirected away from /billing",
    p17PagePatient.status >= 300 && p17PagePatient.status < 400,
    String(p17PagePatient.status),
  );

  const p17DetailPage = await page(`/billing/${p17ManualId}`, superAdmin);
  t("[17] invoice detail page renders", p17DetailPage.status === 200, String(p17DetailPage.status));

  const p17OwnerPage = await page(`/billing/${p17InvA2Id}`, patient1Cookie);
  t(
    "[17] owner can open their invoice page",
    p17OwnerPage.status === 200,
    String(p17OwnerPage.status),
  );

  const p17BookingPage = await page(`/lab-bookings/${p17BookingAId}`, staff);
  t(
    "[17] booking detail page renders (invoice panel)",
    p17BookingPage.status === 200,
    String(p17BookingPage.status),
  );

  /* ---------------- [18] inventory & stock ---------------- */
  console.log("\n[18] inventory & stock (append-only movement history)");

  // ---- anonymous + role gating ----
  const p18Anon = await api("GET", "/api/inventory");
  expectStatus("[18] anonymous inventory list -> 401", p18Anon, 401);

  const p18PatientList = await api("GET", "/api/inventory", {
    cookie: patient1Cookie,
  });
  expectStatus("[18] patient inventory list -> 403", p18PatientList, 403);

  const p18PatientPost = await api("POST", "/api/inventory", {
    cookie: patient1Cookie,
    body: {
      name: "Sneaky item",
      category: "CONSUMABLE",
      unit: "BOX",
      laboratoryId: labId,
    },
  });
  expectStatus("[18] patient cannot create items -> 403", p18PatientPost, 403);

  const p18Collector = await api("GET", "/api/inventory", {
    cookie: collector1.cookie,
  });
  expectStatus("[18] collector inventory list -> 403", p18Collector, 403);

  const p18Doctor = await api("GET", "/api/inventory", { cookie: doctor });
  expectStatus("[18] doctor inventory list -> 403", p18Doctor, 403);

  // ---- item creation: quantity is not an accepted key ----
  const p18Create = await api("POST", "/api/inventory", {
    cookie: labManager,
    body: {
      name: "P18 Review Glove Box",
      category: "CONSUMABLE",
      unit: "PIECE",
      reorderLevel: 20,
      laboratoryId: labId,
      quantity: 50,
    },
  });
  expectStatus("[18] create item -> 201", p18Create, 201);
  const p18Item = p18Create.json?.data;
  const p18ItemId = p18Item?.id;
  t(
    "[18] new item starts at zero even with a smuggled quantity key",
    p18Item?.quantity === 0,
    String(p18Item?.quantity),
  );
  t(
    "[18] new zero-quantity item flags low stock against its reorder level",
    p18Item?.reorderLevel === 20 &&
      p18Item?.lowStock === true &&
      p18Item?.expiryState === "OK",
    JSON.stringify({
      reorder: p18Item?.reorderLevel,
      lowStock: p18Item?.lowStock,
      expiryState: p18Item?.expiryState,
    }),
  );

  const p18BadCategory = await api("POST", "/api/inventory", {
    cookie: labManager,
    body: {
      name: "Bad category item",
      category: "MEDICINE",
      unit: "BOX",
      laboratoryId: labId,
    },
  });
  expectStatus("[18] unknown category -> 400", p18BadCategory, 400);

  const p18ShortName = await api("POST", "/api/inventory", {
    cookie: labManager,
    body: {
      name: "X",
      category: "OTHER",
      unit: "BOX",
      laboratoryId: labId,
    },
  });
  expectStatus("[18] one-character name -> 400", p18ShortName, 400);

  // ---- metadata PATCH: no quantity write path ----
  const p18PatchQty = await api("PATCH", `/api/inventory/${p18ItemId}`, {
    cookie: labManager,
    body: { quantity: 999 },
  });
  expectStatus("[18] PATCH with a quantity key -> 400", p18PatchQty, 400);
  t(
    "[18] quantity rejection names stock transactions",
    String(p18PatchQty.json?.error ?? "").includes(
      "Quantity changes must be recorded as stock transactions.",
    ),
    JSON.stringify(p18PatchQty.json),
  );

  const p18PatchMeta = await api("PATCH", `/api/inventory/${p18ItemId}`, {
    cookie: labManager,
    body: { name: "P18 Review Gloves", reorderLevel: 20 },
  });
  expectStatus("[18] metadata patch -> 200", p18PatchMeta, 200);
  t(
    "[18] metadata patch keeps quantity untouched at zero",
    p18PatchMeta.json?.data?.name === "P18 Review Gloves" &&
      p18PatchMeta.json?.data?.quantity === 0,
    JSON.stringify({
      name: p18PatchMeta.json?.data?.name,
      quantity: p18PatchMeta.json?.data?.quantity,
    }),
  );

  // ---- expiry indicators ----
  const p18Past = new Date(Date.now() - 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const p18Soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const p18ExpPast = await api("PATCH", `/api/inventory/${p18ItemId}`, {
    cookie: labManager,
    body: { expiryDate: p18Past },
  });
  expectStatus("[18] set a past expiry -> 200", p18ExpPast, 200);
  t(
    "[18] past expiry reports EXPIRED",
    p18ExpPast.json?.data?.expiryState === "EXPIRED",
    p18ExpPast.json?.data?.expiryState,
  );

  const p18ExpSoon = await api("PATCH", `/api/inventory/${p18ItemId}`, {
    cookie: labManager,
    body: { expiryDate: p18Soon },
  });
  expectStatus("[18] set a near expiry -> 200", p18ExpSoon, 200);
  t(
    "[18] near expiry reports EXPIRING",
    p18ExpSoon.json?.data?.expiryState === "EXPIRING",
    p18ExpSoon.json?.data?.expiryState,
  );

  // ---- stock movements: schema-signed deltas ----
  const p18In = await api("POST", `/api/inventory/${p18ItemId}/transactions`, {
    cookie: labManager,
    body: { type: "IN", delta: 50 },
  });
  expectStatus("[18] receive 50 -> 201", p18In, 201);
  t(
    "[18] movement returns the appended row and refreshed item",
    p18In.json?.data?.transaction?.type === "IN" &&
      p18In.json?.data?.transaction?.delta === 50 &&
      p18In.json?.data?.transaction?.status === "APPLIED" &&
      p18In.json?.data?.transaction?.quantityAfter === 50 &&
      p18In.json?.data?.item?.quantity === 50,
    JSON.stringify(p18In.json?.data),
  );
  t(
    "[18] movement row names the acting user",
    Boolean(p18In.json?.data?.transaction?.performedByName),
    p18In.json?.data?.transaction?.performedByName,
  );

  const p18InNeg = await api(
    "POST",
    `/api/inventory/${p18ItemId}/transactions`,
    { cookie: labManager, body: { type: "IN", delta: -3 } },
  );
  expectStatus("[18] negative IN -> 400", p18InNeg, 400);

  const p18OutPos = await api(
    "POST",
    `/api/inventory/${p18ItemId}/transactions`,
    { cookie: staff, body: { type: "OUT", delta: 10 } },
  );
  expectStatus("[18] positive OUT -> 400", p18OutPos, 400);

  const p18Out = await api("POST", `/api/inventory/${p18ItemId}/transactions`, {
    cookie: staff,
    body: { type: "OUT", delta: -10 },
  });
  expectStatus("[18] consume 10 -> 201", p18Out, 201);
  t(
    "[18] conditional decrement lands at 40",
    p18Out.json?.data?.item?.quantity === 40 &&
      p18Out.json?.data?.transaction?.quantityAfter === 40,
    String(p18Out.json?.data?.item?.quantity),
  );

  const p18OutTooMuch = await api(
    "POST",
    `/api/inventory/${p18ItemId}/transactions`,
    { cookie: labManager, body: { type: "OUT", delta: -100 } },
  );
  expectStatus("[18] over-consumption -> 409", p18OutTooMuch, 409);
  t(
    "[18] 409 names the remaining quantity",
    String(p18OutTooMuch.json?.error ?? "").includes(
      "Insufficient stock: only 40",
    ),
    JSON.stringify(p18OutTooMuch.json),
  );

  const p18Adjust = await api(
    "POST",
    `/api/inventory/${p18ItemId}/transactions`,
    { cookie: labManager, body: { type: "ADJUST", delta: -5 } },
  );
  expectStatus("[18] cycle-count correction -> 201", p18Adjust, 201);
  t(
    "[18] adjustment lands at 35",
    p18Adjust.json?.data?.item?.quantity === 35,
    String(p18Adjust.json?.data?.item?.quantity),
  );

  const p18AdjustZero = await api(
    "POST",
    `/api/inventory/${p18ItemId}/transactions`,
    { cookie: labManager, body: { type: "ADJUST", delta: 0 } },
  );
  expectStatus("[18] zero delta -> 400", p18AdjustZero, 400);

  // ---- history is append-only (no edit/delete surface) ----
  const p18TxDel = await api(
    "DELETE",
    `/api/inventory/${p18ItemId}/transactions`,
    { cookie: labManager },
  );
  t(
    "[18] DELETE on movements is not routed (405)",
    p18TxDel.status === 405,
    String(p18TxDel.status),
  );
  const p18TxPatch = await api(
    "PATCH",
    `/api/inventory/${p18ItemId}/transactions`,
    { cookie: labManager, body: { delta: 1 } },
  );
  t(
    "[18] PATCH on movements is not routed (405)",
    p18TxPatch.status === 405,
    String(p18TxPatch.status),
  );

  const p18History = await api(
    "GET",
    `/api/inventory/${p18ItemId}/transactions?limit=25`,
    { cookie: labManager },
  );
  expectStatus("[18] movement history -> 200", p18History, 200);
  const p18HistoryRows = p18History.json?.data ?? [];
  t(
    "[18] history keeps every attempt newest first (applied + rejected)",
    p18HistoryRows.length === 4 &&
      p18HistoryRows[0].type === "ADJUST" &&
      p18HistoryRows[0].delta === -5 &&
      p18HistoryRows[0].status === "APPLIED" &&
      p18HistoryRows[1].type === "OUT" &&
      p18HistoryRows[1].delta === -100 &&
      p18HistoryRows[1].status === "REJECTED" &&
      p18HistoryRows[2].type === "OUT" &&
      p18HistoryRows[2].delta === -10 &&
      p18HistoryRows[2].status === "APPLIED" &&
      p18HistoryRows[3].type === "IN" &&
      p18HistoryRows[3].delta === 50 &&
      p18HistoryRows[3].status === "APPLIED" &&
      p18HistoryRows.every((row) => typeof row.performedByName === "string"),
    JSON.stringify(
      p18HistoryRows.map((row) => `${row.type}:${row.delta}:${row.status}`),
    ),
  );

  // ---- concurrent decrements settle exactly once ----
  const p18Race = await Promise.all([
    api("POST", `/api/inventory/${p18ItemId}/transactions`, {
      cookie: labManager,
      body: { type: "OUT", delta: -20 },
    }),
    api("POST", `/api/inventory/${p18ItemId}/transactions`, {
      cookie: staff,
      body: { type: "OUT", delta: -20 },
    }),
  ]);
  const p18RaceStatuses = p18Race.map((res) => res.status).sort((a, b) => a - b);
  t(
    "[18] racing over-draws apply exactly once",
    p18RaceStatuses[0] === 201 && p18RaceStatuses[1] === 409,
    JSON.stringify(p18RaceStatuses),
  );
  const p18AfterRace = await api("GET", `/api/inventory/${p18ItemId}`, {
    cookie: labManager,
  });
  expectStatus("[18] item after the race -> 200", p18AfterRace, 200);
  t(
    "[18] stock landed at 15 (35 minus one of two twenties)",
    p18AfterRace.json?.data?.quantity === 15,
    String(p18AfterRace.json?.data?.quantity),
  );

  // ---- equipment guards ----
  const p18Equip = await api("POST", "/api/inventory", {
    cookie: labManager,
    body: {
      name: "P18 Review Microscope",
      category: "EQUIPMENT",
      unit: "PIECE",
      reorderLevel: 1,
      laboratoryId: labId,
    },
  });
  expectStatus("[18] create equipment item -> 201", p18Equip, 201);
  const p18EquipId = p18Equip.json?.data?.id;

  const p18EquipIn = await api(
    "POST",
    `/api/inventory/${p18EquipId}/transactions`,
    { cookie: labManager, body: { type: "IN", delta: 1 } },
  );
  expectStatus("[18] equipment receipt -> 201", p18EquipIn, 201);

  const p18EquipOut = await api(
    "POST",
    `/api/inventory/${p18EquipId}/transactions`,
    { cookie: labManager, body: { type: "OUT", delta: -1 } },
  );
  expectStatus("[18] equipment OUT -> 400", p18EquipOut, 400);
  t(
    "[18] equipment OUT message names ADJUST",
    String(p18EquipOut.json?.error ?? "").includes(
      "Equipment stock cannot be moved OUT",
    ),
    JSON.stringify(p18EquipOut.json),
  );

  const p18EquipAdjust = await api(
    "POST",
    `/api/inventory/${p18EquipId}/transactions`,
    { cookie: labManager, body: { type: "ADJUST", delta: -1 } },
  );
  expectStatus("[18] equipment cycle count -> 201", p18EquipAdjust, 201);

  // ---- filters + list surface ----
  const p18Search = await api(
    "GET",
    "/api/inventory?search=Microscope",
    { cookie: labManager },
  );
  expectStatus("[18] name search -> 200", p18Search, 200);
  t(
    "[18] name search finds the equipment row",
    (p18Search.json?.data ?? []).some(
      (row) => row.id === p18EquipId && row.category === "EQUIPMENT",
    ),
  );

  const p18CatFilter = await api(
    "GET",
    "/api/inventory?category=CONSUMABLE",
    { cookie: labManager },
  );
  expectStatus("[18] category filter -> 200", p18CatFilter, 200);
  t(
    "[18] category filter returns only consumables",
    (p18CatFilter.json?.data ?? []).length > 0 &&
      (p18CatFilter.json?.data ?? []).every(
        (row) => row.category === "CONSUMABLE",
      ),
  );

  const p18LowFilter = await api(
    "GET",
    "/api/inventory?lowStock=true",
    { cookie: labManager },
  );
  expectStatus("[18] low-stock filter -> 200", p18LowFilter, 200);
  t(
    "[18] low-stock filter returns the 15 <= 20 row",
    (p18LowFilter.json?.data ?? []).some((row) => row.id === p18ItemId),
  );

  const p18ExpFilter = await api(
    "GET",
    "/api/inventory?expiring=true",
    { cookie: labManager },
  );
  expectStatus("[18] expiring filter -> 200", p18ExpFilter, 200);
  t(
    "[18] expiring filter includes the near-dated row",
    (p18ExpFilter.json?.data ?? []).some((row) => row.id === p18ItemId),
  );

  const p18BadFilter = await api(
    "GET",
    "/api/inventory?category=NOT_A_CATEGORY",
    { cookie: labManager },
  );
  expectStatus("[18] malformed category filter -> 400", p18BadFilter, 400);

  // ---- cross-laboratory scoping ----
  const p18Lab2Item = await api("POST", "/api/inventory", {
    cookie: scopeACookie,
    body: {
      name: "P18 Lab2 Buffer",
      category: "REAGENT",
      unit: "VIAL",
      reorderLevel: 5,
      laboratoryId: scopeLab2Id,
    },
  });
  expectStatus("[18] scoped LM creates an item in its lab -> 201", p18Lab2Item, 201);
  const p18Lab2ItemId = p18Lab2Item.json?.data?.id;

  const p18ScopeCreateCross = await api("POST", "/api/inventory", {
    cookie: scopeBCookie,
    body: {
      name: "P18 Cross Lab Item",
      category: "OTHER",
      unit: "BOX",
      laboratoryId: scopeLab2Id,
    },
  });
  expectStatus("[18] scoped create outside scope -> 404", p18ScopeCreateCross, 404);

  const p18CrossGet = await api("GET", `/api/inventory/${p18ItemId}`, {
    cookie: scopeACookie,
  });
  expectStatus("[18] cross-lab item read -> 404", p18CrossGet, 404);

  const p18CrossPatch = await api("PATCH", `/api/inventory/${p18ItemId}`, {
    cookie: scopeACookie,
    body: { name: "Renamed elsewhere" },
  });
  expectStatus("[18] cross-lab item patch -> 404", p18CrossPatch, 404);

  const p18CrossTx = await api(
    "POST",
    `/api/inventory/${p18ItemId}/transactions`,
    { cookie: scopeACookie, body: { type: "IN", delta: 1 } },
  );
  expectStatus("[18] cross-lab movement -> 404", p18CrossTx, 404);

  const p18CrossHistory = await api(
    "GET",
    `/api/inventory/${p18ItemId}/transactions`,
    { cookie: scopeACookie },
  );
  expectStatus("[18] cross-lab history -> 404", p18CrossHistory, 404);

  const p18ScopedList = await api("GET", "/api/inventory?limit=50", {
    cookie: scopeACookie,
  });
  expectStatus("[18] scoped list -> 200", p18ScopedList, 200);
  const p18ScopedRows = p18ScopedList.json?.data ?? [];
  t(
    "[18] scoped list contains only its own laboratory",
    p18ScopedRows.length > 0 &&
      p18ScopedRows.every((row) => row.laboratoryId === scopeLab2Id),
    JSON.stringify(p18ScopedRows.map((row) => row.laboratoryId)),
  );

  const p18ScopeCrossParam = await api(
    "GET",
    `/api/inventory?laboratoryId=${labId}`,
    { cookie: scopeACookie },
  );
  expectStatus("[18] out-of-scope laboratory filter -> 200", p18ScopeCrossParam, 200);
  t(
    "[18] out-of-scope laboratory filter intersects to zero rows",
    (p18ScopeCrossParam.json?.data ?? []).length === 0,
    String((p18ScopeCrossParam.json?.data ?? []).length),
  );

  const p18WideList = await api("GET", "/api/inventory?limit=50", {
    cookie: labManager,
  });
  expectStatus("[18] platform-wide list -> 200", p18WideList, 200);
  t(
    "[18] legacy platform-wide LM sees both laboratories",
    (p18WideList.json?.data ?? []).some((row) => row.id === p18ItemId) &&
      (p18WideList.json?.data ?? []).some((row) => row.id === p18Lab2ItemId),
  );

  // ---- recovery scan: stale PENDING row finalises on read ----
  const p18StaleId = new mongoose.Types.ObjectId();
  await mongoose.connection.db.collection("stocktransactions").insertOne({
    _id: p18StaleId,
    itemId: String(p18ItemId),
    laboratoryId: labId,
    type: "ADJUST",
    delta: 7,
    quantityAfter: null,
    status: "PENDING",
    performedBy: sessions.LAB_MANAGER.user.id,
    createdAt: new Date(Date.now() - 120_000),
    updatedAt: new Date(Date.now() - 120_000),
  });

  const p18HealList = await api(
    "GET",
    "/api/inventory?search=Review%20Gloves",
    { cookie: labManager },
  );
  expectStatus("[18] healing read -> 200", p18HealList, 200);
  t(
    "[18] recovery applied the interrupted movement (15 + 7 = 22)",
    p18HealList.json?.data?.[0]?.quantity === 22,
    String(p18HealList.json?.data?.[0]?.quantity),
  );

  const p18HealHistory = await api(
    "GET",
    `/api/inventory/${p18ItemId}/transactions?limit=25`,
    { cookie: labManager },
  );
  expectStatus("[18] history after healing -> 200", p18HealHistory, 200);
  const p18HealedRow = (p18HealHistory.json?.data ?? []).find(
    (row) => row.id === String(p18StaleId),
  );
  t(
    "[18] stale row finalised as APPLIED with its balance",
    p18HealedRow?.status === "APPLIED" && p18HealedRow?.quantityAfter === 22,
    JSON.stringify(p18HealedRow),
  );

  // ---- pages ----
  const p18PageLm = await page("/inventory", labManager);
  t(
    "[18] /inventory renders for lab manager",
    p18PageLm.status === 200,
    String(p18PageLm.status),
  );

  const p18PageStaff = await page("/inventory", staff);
  t(
    "[18] /inventory renders for staff",
    p18PageStaff.status === 200,
    String(p18PageStaff.status),
  );

  const p18PagePatient = await page("/inventory", patient1Cookie);
  t(
    "[18] patient is redirected away from /inventory",
    p18PagePatient.status >= 300 && p18PagePatient.status < 400,
    String(p18PagePatient.status),
  );

  const p18DetailPage = await page(`/inventory/${p18ItemId}`, labManager);
  t(
    "[18] item detail page renders",
    p18DetailPage.status === 200,
    String(p18DetailPage.status),
  );

  const p18DetailPagePatient = await page(
    `/inventory/${p18ItemId}`,
    patient1Cookie,
  );
  t(
    "[18] patient is redirected away from the item page",
    p18DetailPagePatient.status >= 300 &&
      p18DetailPagePatient.status < 400,
    String(p18DetailPagePatient.status),
  );

  /* ---------------- [19] appointments and consultations ---------------- */
  console.log("\n[19] patient/doctor appointment and consultation workflow");

  // Fresh doctor session: this section is what first links a doctor profile
  // to the Review Doctor login account.
  const p19DocSession = await login("review.doctor@example.com");
  const p19Doc = p19DocSession.cookie;

  /* ---- fixture: clinic + linked doctor profile (schedule configured) ---- */
  const p19ClinicRes = await api("POST", "/api/clinics", {
    cookie: superAdmin,
    body: {
      name: "Review P19 Clinic",
      code: "RW-P19-CLINIC",
      city: "Pune",
      state: "Maharashtra",
    },
  });
  expectStatus("[19] clinic create -> 201", p19ClinicRes, 201);
  const p19ClinicId = p19ClinicRes.json?.data?.id;
  t(
    "[19] clinic id returned",
    typeof p19ClinicId === "string" && p19ClinicId.length > 0,
  );

  const p19Schedule = {
    timezone: "Asia/Kolkata",
    operatingDays: [1, 2, 3, 4, 5],
    openingTime: "09:00",
    closingTime: "17:00",
    slotDurationMinutes: 30,
    maxAdvanceDays: 30,
    breaks: [{ start: "13:00", end: "14:00" }],
    unavailableDates: [],
  };
  const p19DoctorId = String(
    (
      await mongoose.connection.db.collection("doctors").insertOne({
        userId: new mongoose.Types.ObjectId(p19DocSession.user.id),
        clinicId: new mongoose.Types.ObjectId(p19ClinicId),
        doctorCode: "RW-P19-DOC",
        name: "Review Appointment Doctor",
        email: "review.p19.doctor@example.com",
        phone: "+91 9100000190",
        specialization: "General Medicine",
        qualification: "MBBS",
        registrationNumber: null,
        experienceYears: 8,
        consultationFee: 500,
        gender: null,
        dateOfBirth: null,
        bio: null,
        scheduleConfig: p19Schedule,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ).insertedId,
  );

  // Second active doctor with NO schedule - availability must say
  // NOT_CONFIGURED instead of inventing slots, and booking must be refused.
  const p19NoSchedDoctorId = String(
    (
      await mongoose.connection.db.collection("doctors").insertOne({
        clinicId: new mongoose.Types.ObjectId(p19ClinicId),
        doctorCode: "RW-P19-DOC2",
        name: "Review Unscheduled Doctor",
        email: "review.p19.doctor2@example.com",
        phone: null,
        specialization: "Cardiology",
        qualification: null,
        registrationNumber: null,
        experienceYears: null,
        consultationFee: null,
        gender: null,
        dateOfBirth: null,
        bio: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ).insertedId,
  );

  /* ---- directory privacy ---- */
  const p19DirList = await api("GET", "/api/doctors/directory?limit=50", {
    cookie: patient1Cookie,
  });
  expectStatus("[19] patient can browse the directory -> 200", p19DirList, 200);
  const p19DirEntry = (p19DirList.json?.data ?? []).find(
    (row) => row.id === p19DoctorId,
  );
  t("[19] directory lists the fixture doctor", Boolean(p19DirEntry));
  t(
    "[19] directory advertises schedule state and appointment types",
    p19DirEntry?.scheduleConfigured === true &&
      Array.isArray(p19DirEntry?.appointmentTypes) &&
      p19DirEntry.appointmentTypes.includes("ONLINE"),
    JSON.stringify(p19DirEntry),
  );
  t(
    "[19] directory row carries no private contact fields",
    p19DirEntry !== undefined &&
      !("email" in p19DirEntry) &&
      !("phone" in p19DirEntry) &&
      !("userId" in p19DirEntry),
    JSON.stringify(p19DirEntry),
  );

  const p19DirDetail = await api(
    "GET",
    `/api/doctors/directory/${p19DoctorId}`,
    { cookie: patient1Cookie },
  );
  expectStatus("[19] public-safe profile -> 200", p19DirDetail, 200);
  const p19Profile = p19DirDetail.json?.data ?? {};
  t(
    "[19] profile detail never leaks private fields",
    p19Profile.name === "Review Appointment Doctor" &&
      p19Profile.email === undefined &&
      p19Profile.phone === undefined &&
      p19Profile.userId === undefined &&
      p19Profile.registrationNumber === undefined,
    JSON.stringify(p19Profile),
  );

  const p19DirStaff = await api("GET", "/api/doctors/directory", {
    cookie: staff,
  });
  expectStatus(
    "[19] operational staff cannot browse the patient directory -> 403",
    p19DirStaff,
    403,
  );

  /* ---- availability honesty ---- */
  const p19Today = todayTz();
  const p19NextOpDate = (minAhead) => {
    let date = addDays(p19Today, minAhead);
    for (let i = 0; i < 7; i += 1) {
      const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay();
      if (weekday >= 1 && weekday <= 5) return date;
      date = addDays(date, 1);
    }
    throw new Error("no operating day within a week");
  };
  const p19Date = p19NextOpDate(2);
  const p19LaterDate = p19NextOpDate(5);

  const p19Avail1 = await api(
    "GET",
    `/api/appointments/availability?doctorId=${p19DoctorId}&date=${p19Date}`,
    { cookie: patient1Cookie },
  );
  expectStatus(
    "[19] availability for an operating day -> 200",
    p19Avail1,
    200,
  );
  const p19Slots = p19Avail1.json?.data?.slots ?? [];
  t("[19] schedule-derived slots are offered", p19Slots.length > 0);
  t(
    "[19] break windows are never offered",
    p19Slots.every((slot) => slot.start !== "13:00" && slot.start !== "13:30"),
    JSON.stringify(p19Slots.slice(0, 8)),
  );
  t(
    "[19] slots stay inside the configured consultation hours",
    p19Slots.every(
      (slot) => slot.start >= "09:00" && slot.end <= "17:00" && slot.available === true,
    ),
    JSON.stringify(p19Slots.slice(0, 3)),
  );

  const p19Past = await api(
    "GET",
    `/api/appointments/availability?doctorId=${p19DoctorId}&date=${addDays(p19Today, -1)}`,
    { cookie: patient1Cookie },
  );
  expectStatus(
    "[19] past-date availability answers honestly -> 200",
    p19Past,
    200,
  );
  t(
    "[19] past date reports DATE_OUT_OF_RANGE with no slots",
    p19Past.json?.data?.bookable === false &&
      p19Past.json?.data?.unavailableReason === "DATE_OUT_OF_RANGE" &&
      (p19Past.json?.data?.slots ?? []).length === 0,
    JSON.stringify(p19Past.json?.data),
  );

  let p19Sunday = p19Today;
  for (let i = 1; i <= 7; i += 1) {
    p19Sunday = addDays(p19Today, i);
    if (new Date(`${p19Sunday}T00:00:00.000Z`).getUTCDay() === 0) break;
  }
  const p19NonOp = await api(
    "GET",
    `/api/appointments/availability?doctorId=${p19DoctorId}&date=${p19Sunday}`,
    { cookie: patient1Cookie },
  );
  expectStatus(
    "[19] non-operating-day availability -> 200",
    p19NonOp,
    200,
  );
  t(
    "[19] Sunday reports NOT_OPERATING_DAY",
    p19NonOp.json?.data?.unavailableReason === "NOT_OPERATING_DAY",
    String(p19NonOp.json?.data?.unavailableReason),
  );

  const p19NoSchedAvail = await api(
    "GET",
    `/api/appointments/availability?doctorId=${p19NoSchedDoctorId}&date=${p19Date}`,
    { cookie: patient1Cookie },
  );
  expectStatus(
    "[19] unconfigured doctor availability -> 200",
    p19NoSchedAvail,
    200,
  );
  t(
    "[19] unconfigured schedule reports NOT_CONFIGURED with no slots",
    p19NoSchedAvail.json?.data?.unavailableReason === "NOT_CONFIGURED" &&
      (p19NoSchedAvail.json?.data?.slots ?? []).length === 0,
    JSON.stringify(p19NoSchedAvail.json?.data),
  );

  /* ---- booking: creation, idempotency, capacity, delegation ---- */
  const p19Slot = p19Slots.find((slot) => slot.available)?.start;
  t("[19] a bookable slot exists to reserve", typeof p19Slot === "string");

  const p19BookingBody = {
    doctorId: p19DoctorId,
    appointmentDate: p19Date,
    timeSlot: p19Slot,
    appointmentType: "CLINIC_VISIT",
    reason: "Persistent cough for a week",
    idempotencyKey: "rw-p19-idem-0001",
  };
  const p19Create1 = await api("POST", "/api/appointments", {
    cookie: patient1Cookie,
    body: p19BookingBody,
  });
  expectStatus("[19] patient booking -> 201", p19Create1, 201);
  const p19Apt1 = p19Create1.json?.data;
  t(
    "[19] new appointment starts PENDING with a reference code",
    p19Apt1?.status === "PENDING" &&
      /^APT-\d{4}-\d{6}$/.test(p19Apt1?.appointmentCode ?? ""),
    JSON.stringify(p19Apt1),
  );

  const p19Replay = await api("POST", "/api/appointments", {
    cookie: patient1Cookie,
    body: p19BookingBody,
  });
  expectStatus("[19] idempotent replay -> 200", p19Replay, 200);
  t(
    "[19] replay returns the original appointment",
    p19Replay.json?.data?.id === p19Apt1.id &&
      p19Replay.json?.data?.appointmentCode === p19Apt1.appointmentCode,
    JSON.stringify(p19Replay.json?.data),
  );

  const p19Race = await api("POST", "/api/appointments", {
    cookie: patient2Cookie,
    body: {
      doctorId: p19DoctorId,
      appointmentDate: p19Date,
      timeSlot: p19Slot,
      appointmentType: "ONLINE",
      reason: "Follow-up for blood reports",
    },
  });
  expectStatus("[19] capacity one rejects the second booking -> 409", p19Race, 409);
  t(
    "[19] capacity rejection points at the time slot",
    Array.isArray(p19Race.json?.issues) &&
      p19Race.json.issues.some((issue) => issue.field === "timeSlot"),
    JSON.stringify(p19Race.json?.issues),
  );

  const p19Slot2 = p19Slots.find(
    (slot) => slot.available && slot.start !== p19Slot,
  )?.start;
  const p19Create2 = await api("POST", "/api/appointments", {
    cookie: patient2Cookie,
    body: {
      doctorId: p19DoctorId,
      appointmentDate: p19Date,
      timeSlot: p19Slot2,
      appointmentType: "ONLINE",
      reason: "Online review of lab results",
    },
  });
  expectStatus(
    "[19] second patient books another slot online -> 201",
    p19Create2,
    201,
  );
  const p19Apt2 = p19Create2.json?.data;

  const p19AvailAfter1 = await api(
    "GET",
    `/api/appointments/availability?doctorId=${p19DoctorId}&date=${p19Date}`,
    { cookie: patient1Cookie },
  );
  expectStatus("[19] availability refresh after booking -> 200", p19AvailAfter1, 200);
  const p19TakenRow = (p19AvailAfter1.json?.data?.slots ?? []).find(
    (slot) => slot.start === p19Slot,
  );
  t(
    "[19] claimed slot now shows no remaining capacity",
    p19TakenRow?.available === false,
    JSON.stringify(p19TakenRow),
  );

  const p19Create3 = await api("POST", "/api/appointments", {
    cookie: superAdmin,
    body: {
      doctorId: p19DoctorId,
      appointmentDate: p19LaterDate,
      timeSlot: "10:00",
      appointmentType: "CLINIC_VISIT",
      patientUserId: p1.user.id,
      reason: "Booked by the front desk",
    },
  });
  expectStatus("[19] super admin books on behalf of a patient -> 201", p19Create3, 201);
  const p19Apt3 = p19Create3.json?.data;
  t(
    "[19] delegated booking lands on the selected patient",
    p19Apt3?.patient?.id === p1.user.id,
    JSON.stringify(p19Apt3?.patient),
  );

  const p19StaffCreate = await api("POST", "/api/appointments", {
    cookie: staff,
    body: {
      doctorId: p19DoctorId,
      appointmentDate: p19LaterDate,
      timeSlot: "11:00",
      appointmentType: "CLINIC_VISIT",
    },
  });
  expectStatus("[19] staff cannot create appointments -> 403", p19StaffCreate, 403);

  const p19NoSchedBook = await api("POST", "/api/appointments", {
    cookie: patient1Cookie,
    body: {
      doctorId: p19NoSchedDoctorId,
      appointmentDate: p19Date,
      timeSlot: "10:00",
      appointmentType: "CLINIC_VISIT",
    },
  });
  expectStatus(
    "[19] booking an unconfigured schedule -> 409",
    p19NoSchedBook,
    409,
  );

  /* ---- list scoping ---- */
  const p19DocList = await api("GET", "/api/appointments?limit=50", {
    cookie: p19Doc,
  });
  expectStatus("[19] doctor appointment list -> 200", p19DocList, 200);
  const p19DocRows = p19DocList.json?.data ?? [];
  t(
    "[19] doctor sees appointments of the linked profile",
    p19DocRows.some((row) => row.id === p19Apt1.id) &&
      p19DocRows.some((row) => row.id === p19Apt2.id),
    JSON.stringify(p19DocRows.map((row) => row.appointmentCode)),
  );

  const p19P1List = await api("GET", "/api/appointments?limit=50", {
    cookie: patient1Cookie,
  });
  expectStatus("[19] patient appointment list -> 200", p19P1List, 200);
  const p19P1Rows = p19P1List.json?.data ?? [];
  t(
    "[19] patient list is hard-scoped to their own appointments",
    p19P1Rows.some((row) => row.id === p19Apt1.id) &&
      !p19P1Rows.some((row) => row.id === p19Apt2.id),
    JSON.stringify(p19P1Rows.map((row) => row.appointmentCode)),
  );

  const p19StaffList = await api("GET", "/api/appointments", { cookie: staff });
  expectStatus(
    "[19] operational staff cannot use the appointment list -> 403",
    p19StaffList,
    403,
  );

  const p19SaList = await api(
    "GET",
    `/api/appointments?doctor=${p19DoctorId}&limit=50`,
    { cookie: superAdmin },
  );
  expectStatus("[19] management list with doctor filter -> 200", p19SaList, 200);
  t(
    "[19] management sees appointments across patients",
    (p19SaList.json?.data ?? []).some((row) => row.id === p19Apt1.id) &&
      (p19SaList.json?.data ?? []).some((row) => row.id === p19Apt2.id),
  );

  /* ---- lifecycle: confirm, start, complete ---- */
  const p19PatientStart = await api(
    "PATCH",
    `/api/appointments/${p19Apt1.id}/status`,
    { cookie: patient1Cookie, body: { status: "IN_PROGRESS" } },
  );
  expectStatus("[19] patient cannot start a consultation -> 403", p19PatientStart, 403);

  const p19StaffConfirm = await api(
    "PATCH",
    `/api/appointments/${p19Apt1.id}/status`,
    { cookie: staff, body: { status: "CONFIRMED" } },
  );
  expectStatus(
    "[19] another role gets a neutral 404 on status changes -> 404",
    p19StaffConfirm,
    404,
  );

  const p19Confirm1 = await api(
    "PATCH",
    `/api/appointments/${p19Apt1.id}/status`,
    { cookie: p19Doc, body: { status: "CONFIRMED" } },
  );
  expectStatus("[19] owning doctor confirms -> 200", p19Confirm1, 200);
  t(
    "[19] confirmation recorded with its reviewer",
    p19Confirm1.json?.data?.status === "CONFIRMED" &&
      Boolean(p19Confirm1.json?.data?.reviewedBy),
    JSON.stringify(p19Confirm1.json?.data),
  );

  const p19Start1 = await api(
    "PATCH",
    `/api/appointments/${p19Apt1.id}/status`,
    { cookie: p19Doc, body: { status: "IN_PROGRESS" } },
  );
  expectStatus("[19] owning doctor starts the consultation -> 200", p19Start1, 200);
  t(
    "[19] start timestamp recorded",
    p19Start1.json?.data?.status === "IN_PROGRESS" &&
      Boolean(p19Start1.json?.data?.startedAt),
    JSON.stringify(p19Start1.json?.data),
  );

  /* ---- consultation record: gates, writes, audit, release ---- */
  const p19PatientConsultEarly = await api(
    "GET",
    `/api/appointments/${p19Apt1.id}/consultation`,
    { cookie: patient1Cookie },
  );
  expectStatus(
    "[19] patient cannot read an unreleased record -> 404",
    p19PatientConsultEarly,
    404,
  );

  const p19SaConsult = await api(
    "GET",
    `/api/appointments/${p19Apt1.id}/consultation`,
    { cookie: superAdmin },
  );
  expectStatus(
    "[19] monitoring roles have no clinical-note access -> 404",
    p19SaConsult,
    404,
  );

  const p19ConsultPayload = {
    notes: "Dry cough, no fever. Chest clear on auscultation.",
    diagnosis: "Viral upper respiratory infection",
    treatmentAdvice: "Rest, warm fluids, steam inhalation.",
    followUp: "Review in 5 days if symptoms persist.",
    prescriptionItems: [
      {
        medicine: "Paracetamol 500mg",
        dosage: "500mg",
        frequency: "TDS",
        duration: "3 days",
        instructions: "After meals",
      },
    ],
  };
  const p19ConsultWrite = await api(
    "PUT",
    `/api/appointments/${p19Apt1.id}/consultation`,
    { cookie: p19Doc, body: p19ConsultPayload },
  );
  expectStatus(
    "[19] doctor writes the record while in progress -> 200",
    p19ConsultWrite,
    200,
  );
  t(
    "[19] fresh record starts with an empty change history",
    Array.isArray(p19ConsultWrite.json?.data?.changeHistory) &&
      p19ConsultWrite.json.data.changeHistory.length === 0,
    JSON.stringify(p19ConsultWrite.json?.data?.changeHistory),
  );

  const p19PatientConsultWrite = await api(
    "PUT",
    `/api/appointments/${p19Apt1.id}/consultation`,
    { cookie: patient1Cookie, body: { notes: "patient edit" } },
  );
  expectStatus(
    "[19] patient cannot write clinical notes -> 403",
    p19PatientConsultWrite,
    403,
  );

  const p19ConsultUpdate = await api(
    "PUT",
    `/api/appointments/${p19Apt1.id}/consultation`,
    {
      cookie: p19Doc,
      body: { ...p19ConsultPayload, diagnosis: "Viral bronchitis" },
    },
  );
  expectStatus("[19] doctor updates the record -> 200", p19ConsultUpdate, 200);
  t(
    "[19] change history captures the edited field",
    p19ConsultUpdate.json?.data?.changeHistory?.[0]?.changedFields?.includes(
      "diagnosis",
    ) === true,
    JSON.stringify(p19ConsultUpdate.json?.data?.changeHistory?.[0]),
  );

  const p19ConsultNoop = await api(
    "PUT",
    `/api/appointments/${p19Apt1.id}/consultation`,
    {
      cookie: p19Doc,
      body: { ...p19ConsultPayload, diagnosis: "Viral bronchitis" },
    },
  );
  expectStatus("[19] unchanged save is a no-op -> 200", p19ConsultNoop, 200);
  t(
    "[19] no-op save appends no history entry",
    (p19ConsultNoop.json?.data?.changeHistory ?? []).length === 1,
    JSON.stringify(p19ConsultNoop.json?.data?.changeHistory),
  );

  const p19Complete1 = await api(
    "PATCH",
    `/api/appointments/${p19Apt1.id}/status`,
    { cookie: p19Doc, body: { status: "COMPLETED" } },
  );
  expectStatus("[19] owning doctor completes -> 200", p19Complete1, 200);
  t(
    "[19] completion exposes the consultation flag",
    p19Complete1.json?.data?.hasConsultation === true,
    JSON.stringify(p19Complete1.json?.data),
  );

  const p19PatientConsult = await api(
    "GET",
    `/api/appointments/${p19Apt1.id}/consultation`,
    { cookie: patient1Cookie },
  );
  expectStatus("[19] patient reads the released record -> 200", p19PatientConsult, 200);
  t(
    "[19] released record carries diagnosis and audit history",
    p19PatientConsult.json?.data?.diagnosis === "Viral bronchitis" &&
      Array.isArray(p19PatientConsult.json?.data?.changeHistory),
    JSON.stringify(p19PatientConsult.json?.data),
  );

  const p19P1ConsultList = await api("GET", "/api/consultations?limit=50", {
    cookie: patient1Cookie,
  });
  expectStatus("[19] patient consultation list -> 200", p19P1ConsultList, 200);
  t(
    "[19] patient list includes the released record",
    (p19P1ConsultList.json?.data ?? []).some(
      (row) => row.appointment?.id === p19Apt1.id,
    ),
    JSON.stringify(p19P1ConsultList.json?.data),
  );

  const p19DocConsultList = await api("GET", "/api/consultations?limit=50", {
    cookie: p19Doc,
  });
  expectStatus("[19] doctor consultation list -> 200", p19DocConsultList, 200);
  t(
    "[19] doctor list includes their own record",
    (p19DocConsultList.json?.data ?? []).some(
      (row) => row.appointment?.id === p19Apt1.id,
    ),
  );

  const p19SaConsultList = await api("GET", "/api/consultations", {
    cookie: superAdmin,
  });
  expectStatus(
    "[19] admin consultation list stays out of clinical notes -> 403",
    p19SaConsultList,
    403,
  );

  const p19Backward = await api(
    "PATCH",
    `/api/appointments/${p19Apt1.id}/status`,
    { cookie: p19Doc, body: { status: "CONFIRMED" } },
  );
  expectStatus("[19] completed is terminal -> 409", p19Backward, 409);

  const p19CancelCompleted = await api(
    "PATCH",
    `/api/appointments/${p19Apt1.id}/cancel`,
    { cookie: p19Doc, body: {} },
  );
  expectStatus(
    "[19] a completed appointment cannot be cancelled -> 409",
    p19CancelCompleted,
    409,
  );

  const p19Detail = await api("GET", `/api/appointments/${p19Apt1.id}`, {
    cookie: patient1Cookie,
  });
  expectStatus("[19] patient detail view -> 200", p19Detail, 200);
  const p19History = (p19Detail.json?.data?.history ?? []).map(
    (entry) => entry.eventType,
  );
  t(
    "[19] audit history records the full journey",
    [
      "APPOINTMENT_CREATED",
      "APPOINTMENT_CONFIRMED",
      "CONSULTATION_STARTED",
      "APPOINTMENT_COMPLETED",
    ].every((type) => p19History.includes(type)),
    JSON.stringify(p19History),
  );

  const p19ProbeDetail = await api("GET", `/api/appointments/${p19Apt1.id}`, {
    cookie: patient2Cookie,
  });
  expectStatus(
    "[19] another patient gets a neutral 404 -> 404",
    p19ProbeDetail,
    404,
  );

  /* ---- second appointment: write gate, reschedule, cancel ---- */
  const p19Confirm2 = await api(
    "PATCH",
    `/api/appointments/${p19Apt2.id}/status`,
    { cookie: p19Doc, body: { status: "CONFIRMED" } },
  );
  expectStatus("[19] second appointment confirmed -> 200", p19Confirm2, 200);

  const p19ConsultTooEarly = await api(
    "PUT",
    `/api/appointments/${p19Apt2.id}/consultation`,
    { cookie: p19Doc, body: { notes: "premature" } },
  );
  expectStatus(
    "[19] record blocked until the consultation starts -> 409",
    p19ConsultTooEarly,
    409,
  );

  const p19AvailLater = await api(
    "GET",
    `/api/appointments/availability?doctorId=${p19DoctorId}&date=${p19LaterDate}`,
    { cookie: patient2Cookie },
  );
  expectStatus("[19] later-date availability -> 200", p19AvailLater, 200);
  const p19LaterSlot = (p19AvailLater.json?.data?.slots ?? []).find(
    (slot) => slot.available && slot.start !== "10:00",
  )?.start;
  t(
    "[19] a free slot exists on the reschedule date",
    typeof p19LaterSlot === "string",
    JSON.stringify(p19AvailLater.json?.data?.slots?.slice(0, 6)),
  );

  const p19WrongOwner = await api(
    "PATCH",
    `/api/appointments/${p19Apt2.id}/reschedule`,
    {
      cookie: patient1Cookie,
      body: { appointmentDate: p19LaterDate, timeSlot: p19LaterSlot },
    },
  );
  expectStatus("[19] non-owner cannot reschedule -> 404", p19WrongOwner, 404);

  const p19OntoTaken = await api(
    "PATCH",
    `/api/appointments/${p19Apt2.id}/reschedule`,
    {
      cookie: patient2Cookie,
      body: { appointmentDate: p19LaterDate, timeSlot: "10:00" },
    },
  );
  expectStatus(
    "[19] reschedule onto a held slot -> 409",
    p19OntoTaken,
    409,
  );

  const p19Reschedule = await api(
    "PATCH",
    `/api/appointments/${p19Apt2.id}/reschedule`,
    {
      cookie: patient2Cookie,
      body: { appointmentDate: p19LaterDate, timeSlot: p19LaterSlot },
    },
  );
  expectStatus("[19] owning patient reschedules -> 200", p19Reschedule, 200);
  t(
    "[19] appointment moved to the new time",
    p19Reschedule.json?.data?.date === p19LaterDate &&
      p19Reschedule.json?.data?.timeSlot === p19LaterSlot,
    JSON.stringify(p19Reschedule.json?.data),
  );

  const p19AvailOldAfter = await api(
    "GET",
    `/api/appointments/availability?doctorId=${p19DoctorId}&date=${p19Date}`,
    { cookie: patient2Cookie },
  );
  expectStatus(
    "[19] original-day availability after the move -> 200",
    p19AvailOldAfter,
    200,
  );
  const p19VacatedRow = (p19AvailOldAfter.json?.data?.slots ?? []).find(
    (slot) => slot.start === p19Slot2,
  );
  t(
    "[19] vacated slot is bookable again",
    p19VacatedRow?.available === true,
    JSON.stringify(p19VacatedRow),
  );

  const p19AvailLaterAfter = await api(
    "GET",
    `/api/appointments/availability?doctorId=${p19DoctorId}&date=${p19LaterDate}`,
    { cookie: patient2Cookie },
  );
  expectStatus(
    "[19] later-date availability after the move -> 200",
    p19AvailLaterAfter,
    200,
  );
  const p19HeldRow = (p19AvailLaterAfter.json?.data?.slots ?? []).find(
    (slot) => slot.start === p19LaterSlot,
  );
  t(
    "[19] moved-into slot now shows no capacity",
    p19HeldRow?.available === false,
    JSON.stringify(p19HeldRow),
  );

  const p19Cancel2 = await api(
    "PATCH",
    `/api/appointments/${p19Apt2.id}/cancel`,
    { cookie: p19Doc, body: { reason: "Doctor unavailable - travel delay" } },
  );
  expectStatus("[19] owning doctor cancels -> 200", p19Cancel2, 200);
  t(
    "[19] cancellation recorded with its reason",
    p19Cancel2.json?.data?.status === "CANCELLED" &&
      p19Cancel2.json?.data?.cancellationReason ===
        "Doctor unavailable - travel delay",
    JSON.stringify(p19Cancel2.json?.data),
  );

  const p19CancelAgain = await api(
    "PATCH",
    `/api/appointments/${p19Apt2.id}/cancel`,
    { cookie: patient2Cookie, body: {} },
  );
  expectStatus(
    "[19] a cancelled appointment cannot be cancelled again -> 409",
    p19CancelAgain,
    409,
  );

  const p19AvailAfterCancel = await api(
    "GET",
    `/api/appointments/availability?doctorId=${p19DoctorId}&date=${p19LaterDate}`,
    { cookie: patient2Cookie },
  );
  expectStatus(
    "[19] later-date availability after the cancel -> 200",
    p19AvailAfterCancel,
    200,
  );
  const p19FreedRow = (p19AvailAfterCancel.json?.data?.slots ?? []).find(
    (slot) => slot.start === p19LaterSlot,
  );
  t(
    "[19] cancelled appointment released its slot",
    p19FreedRow?.available === true,
    JSON.stringify(p19FreedRow),
  );

  /* ---- rejection and patient-initiated cancellation ---- */
  const p19Create4 = await api("POST", "/api/appointments", {
    cookie: patient1Cookie,
    body: {
      doctorId: p19DoctorId,
      appointmentDate: p19LaterDate,
      timeSlot: "15:00",
      appointmentType: "CLINIC_VISIT",
      reason: "Second opinion request",
    },
  });
  expectStatus("[19] fourth booking -> 201", p19Create4, 201);
  const p19Apt4 = p19Create4.json?.data;

  const p19RejectNoReason = await api(
    "PATCH",
    `/api/appointments/${p19Apt4.id}/status`,
    { cookie: p19Doc, body: { status: "REJECTED" } },
  );
  expectStatus("[19] rejection requires a reason -> 400", p19RejectNoReason, 400);

  const p19Reject = await api(
    "PATCH",
    `/api/appointments/${p19Apt4.id}/status`,
    { cookie: p19Doc, body: { status: "REJECTED", reason: "Doctor is on leave that day" } },
  );
  expectStatus("[19] doctor rejects with a reason -> 200", p19Reject, 200);
  t(
    "[19] rejection reason persisted",
    p19Reject.json?.data?.status === "REJECTED" &&
      p19Reject.json?.data?.rejectionReason === "Doctor is on leave that day",
    JSON.stringify(p19Reject.json?.data),
  );

  const p19CancelRejected = await api(
    "PATCH",
    `/api/appointments/${p19Apt4.id}/cancel`,
    { cookie: patient1Cookie, body: {} },
  );
  expectStatus(
    "[19] a rejected appointment cannot be cancelled -> 409",
    p19CancelRejected,
    409,
  );

  const p19Create5 = await api("POST", "/api/appointments", {
    cookie: patient1Cookie,
    body: {
      doctorId: p19DoctorId,
      appointmentDate: p19LaterDate,
      timeSlot: "15:30",
      appointmentType: "CLINIC_VISIT",
      reason: "Slot test before cancelling",
    },
  });
  expectStatus("[19] fifth booking -> 201", p19Create5, 201);
  const p19Apt5 = p19Create5.json?.data;

  const p19PatientCancel = await api(
    "PATCH",
    `/api/appointments/${p19Apt5.id}/cancel`,
    { cookie: patient1Cookie, body: { reason: "Plans changed" } },
  );
  expectStatus(
    "[19] patient cancels their own pending appointment -> 200",
    p19PatientCancel,
    200,
  );
  t(
    "[19] patient cancellation recorded",
    p19PatientCancel.json?.data?.status === "CANCELLED" &&
      p19PatientCancel.json?.data?.cancellationReason === "Plans changed",
    JSON.stringify(p19PatientCancel.json?.data),
  );

  const p19Avail5 = await api(
    "GET",
    `/api/appointments/availability?doctorId=${p19DoctorId}&date=${p19LaterDate}`,
    { cookie: patient1Cookie },
  );
  expectStatus(
    "[19] availability after patient cancel -> 200",
    p19Avail5,
    200,
  );
  const p19Slot5Row = (p19Avail5.json?.data?.slots ?? []).find(
    (slot) => slot.start === "15:30",
  );
  t(
    "[19] patient cancellation released its slot",
    p19Slot5Row?.available === true,
    JSON.stringify(p19Slot5Row),
  );

  /* ---- schedule configuration contract ---- */
  const p19SchedGet = await api(
    "GET",
    `/api/doctors/${p19DoctorId}/availability`,
    { cookie: p19Doc },
  );
  expectStatus("[19] doctor reads their schedule config -> 200", p19SchedGet, 200);
  t(
    "[19] stored schedule matches the fixture",
    p19SchedGet.json?.data?.scheduleConfig?.closingTime === "17:00" &&
      Array.isArray(p19SchedGet.json?.data?.scheduleConfig?.operatingDays) &&
      p19SchedGet.json.data.scheduleConfig.operatingDays.length === 5,
    JSON.stringify(p19SchedGet.json?.data),
  );

  const p19SchedPatient = await api(
    "PATCH",
    `/api/doctors/${p19DoctorId}/availability`,
    { cookie: patient1Cookie, body: p19Schedule },
  );
  expectStatus(
    "[19] patients cannot change a schedule (neutral 404) -> 404",
    p19SchedPatient,
    404,
  );

  const p19SchedPatch = await api(
    "PATCH",
    `/api/doctors/${p19DoctorId}/availability`,
    {
      cookie: p19Doc,
      body: { ...p19Schedule, closingTime: "17:30" },
    },
  );
  expectStatus("[19] doctor saves a schedule change -> 200", p19SchedPatch, 200);
  t(
    "[19] schedule change persisted",
    p19SchedPatch.json?.data?.scheduleConfig?.closingTime === "17:30",
    JSON.stringify(p19SchedPatch.json?.data),
  );

  const p19SchedClear = await api(
    "PATCH",
    `/api/doctors/${p19DoctorId}/availability`,
    { cookie: p19Doc, body: null },
  );
  expectStatus("[19] schedule can be cleared -> 200", p19SchedClear, 200);
  t(
    "[19] cleared schedule reports null",
    p19SchedClear.json?.data?.scheduleConfig === null,
    JSON.stringify(p19SchedClear.json?.data),
  );

  const p19SchedRestore = await api(
    "PATCH",
    `/api/doctors/${p19DoctorId}/availability`,
    { cookie: p19Doc, body: p19Schedule },
  );
  expectStatus("[19] schedule restored -> 200", p19SchedRestore, 200);

  /* ---- pages ---- */
  const p19PageMy = await page("/my-appointments", patient1Cookie);
  t(
    "[19] /my-appointments renders for a patient",
    p19PageMy.status === 200,
    String(p19PageMy.status),
  );

  const p19PageFind = await page("/find-a-doctor", patient1Cookie);
  t(
    "[19] /find-a-doctor renders",
    p19PageFind.status === 200,
    String(p19PageFind.status),
  );

  const p19PageRecords = await page("/medical-records", patient1Cookie);
  t(
    "[19] /medical-records renders",
    p19PageRecords.status === 200,
    String(p19PageRecords.status),
  );

  const p19PageDocList = await page("/doctor/appointments", p19Doc);
  t(
    "[19] /doctor/appointments renders",
    p19PageDocList.status === 200,
    String(p19PageDocList.status),
  );

  const p19PageDocSchedule = await page("/doctor/schedule", p19Doc);
  t(
    "[19] /doctor/schedule renders for a linked doctor",
    p19PageDocSchedule.status === 200,
    String(p19PageDocSchedule.status),
  );

  const p19PageDocConsult = await page("/doctor/consultations", p19Doc);
  t(
    "[19] /doctor/consultations renders",
    p19PageDocConsult.status === 200,
    String(p19PageDocConsult.status),
  );

  const p19PageManage = await page("/appointments", superAdmin);
  t(
    "[19] /appointments monitoring page renders",
    p19PageManage.status === 200,
    String(p19PageManage.status),
  );

  const p19PageDetail = await page(
    `/appointments/${p19Apt1.id}`,
    patient1Cookie,
  );
  t(
    "[19] shared detail page renders for the owning patient",
    p19PageDetail.status === 200,
    String(p19PageDetail.status),
  );

  const p19PagePatientDenied = await page("/appointments", patient1Cookie);
  t(
    "[19] patient is redirected away from monitoring",
    p19PagePatientDenied.status >= 300 && p19PagePatientDenied.status < 400,
    String(p19PagePatientDenied.status),
  );

  const p19PageScheduleDenied = await page("/doctor/schedule", patient1Cookie);
  t(
    "[19] patient is redirected away from the schedule editor",
    p19PageScheduleDenied.status >= 300 &&
      p19PageScheduleDenied.status < 400,
    String(p19PageScheduleDenied.status),
  );

  /* ---------------- report ---------------- */
  const total = passed + failures.length;
  if (failures.length > 0) {
    console.error(`\nReview-workflow live tests: ${passed}/${total} passed`);
    for (const failure of failures) {
      console.error(`  ✗ ${failure}`);
    }
    const serverErrors = serverLog
      .join("")
      .split(/\r?\n/)
      .filter((line) => /error|failed|404|exception/i.test(line));
    if (serverErrors.length > 0) {
      console.error("\n  dev server log (error lines):");
      for (const line of serverErrors.slice(-40)) {
        console.error(`    ${line}`);
      }
    }
    process.exitCode = 1;
  } else {
    console.log(`\nReview-workflow live tests: ${passed}/${total} passed`);
  }
}

try {
  await main();
} finally {
  stopServer();
  try {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  } catch {
    // best-effort cleanup
  }
}
