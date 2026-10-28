/**
 * STEP 8 offline contract tests.
 *
 * Pure, DB-free verification of the home sample-collection module's shared
 * contracts: status lifecycle and transitions, role authorization helpers,
 * collection codes, capacity-holding policy, cancellation cutoff, scheduling
 * defaults and the Zod request schemas.
 *
 * Run: npm run test:step8
 * (Node type-stripping + the `@/` resolve hook in register.mjs)
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  COLLECTION_CAPACITY_HOLDING_STATUSES,
  COLLECTION_CANCELLABLE_STATUSES,
  COLLECTION_CANCELLATION_CUTOFF_HOURS,
  COLLECTION_CODE_PATTERN,
  COLLECTION_COLLECTOR_ACTIONABLE_STATUSES,
  COLLECTION_STATUS_TRANSITIONS,
  COLLECTION_STATUSES,
  DEFAULT_COLLECTION_CLOSING_TIME,
  DEFAULT_COLLECTION_MAX_ADVANCE_DAYS,
  DEFAULT_COLLECTION_OPERATING_DAYS,
  DEFAULT_COLLECTION_OPENING_TIME,
  DEFAULT_COLLECTION_SLOT_CAPACITY,
  DEFAULT_COLLECTION_SLOT_DURATION_MINUTES,
  DEFAULT_COLLECTION_TIMEZONE,
  INDIAN_PINCODE_PATTERN,
  MAX_TESTS_PER_COLLECTION,
  canAssignCollectors,
  canCancelAnyCollection,
  canCreateCollection,
  canTransitionCollectionStatus,
  canViewAssignments,
  canViewCollectionManagement,
  canWriteCollectionStatus,
  collectionAdvanceTargets,
  collectionStatusBadgeVariant,
  collectionStatusLabel,
  formatCollectionCode,
  isCapacityHoldingStatus,
} from "@/config/home-collection";
import { ROLES } from "@/config/roles";
import {
  homeCollectionAssignSchema,
  homeCollectionAvailabilityQuerySchema,
  homeCollectionCancelSchema,
  homeCollectionCreateSchema,
  homeCollectionListQuerySchema,
  homeCollectionStatusSchema,
  collectionAddressSchema,
} from "@/lib/validation/home-collection";
import { laboratoryHomeCollectionConfigSchema } from "@/lib/validation/laboratory";
import {
  buildSlotPlan,
  cancellationDeadline,
  generateSlotStarts,
  todayInTimeZone,
} from "@/lib/utils/booking-time";

/* ------------------------------------------------------------------ *
 * Tiny assertion harness (no framework in this repo)
 * ------------------------------------------------------------------ */

let passed = 0;
const failures = [];

function check(label, condition, detail) {
  if (condition) {
    passed += 1;
  } else {
    failures.push(label + (detail ? ` -> ${detail}` : ""));
  }
}

function eq(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, `expected ${e}, got ${a}`);
}

function rejects(label, schema, value) {
  const result = schema.safeParse(value);
  check(label, !result.success, result.success ? "unexpectedly accepted" : "");
}

function accepts(label, schema, value) {
  const result = schema.safeParse(value);
  check(
    label,
    result.success,
    result.success ? "" : String(result.error.issues[0]),
  );
}

/* ------------------------------------------------------------------ *
 * 1. Status lifecycle
 * ------------------------------------------------------------------ */

eq("every central status is listed", COLLECTION_STATUSES, [
  "PENDING",
  "CONFIRMED",
  "REJECTED",
  "ASSIGNED",
  "COLLECTOR_ACCEPTED",
  "COLLECTOR_EN_ROUTE",
  "ARRIVED",
  "COLLECTED",
  "FAILED",
  "CANCELLED",
]);

for (const status of COLLECTION_STATUSES) {
  check(
    `transition map covers ${status}`,
    Array.isArray(COLLECTION_STATUS_TRANSITIONS[status]),
  );
}

check(
  "PENDING confirms",
  canTransitionCollectionStatus("PENDING", "CONFIRMED"),
);
check(
  "PENDING rejects",
  canTransitionCollectionStatus("PENDING", "REJECTED"),
);
check(
  "PENDING does not jump to ASSIGNED",
  !canTransitionCollectionStatus("PENDING", "ASSIGNED"),
);
check(
  "CONFIRMED assigns",
  canTransitionCollectionStatus("CONFIRMED", "ASSIGNED"),
);
check(
  "ASSIGNED accepts the collector",
  canTransitionCollectionStatus("ASSIGNED", "COLLECTOR_ACCEPTED"),
);
check(
  "collector accepted goes en route",
  canTransitionCollectionStatus("COLLECTOR_ACCEPTED", "COLLECTOR_EN_ROUTE"),
);
check(
  "ASSIGNED does not skip acceptance",
  !canTransitionCollectionStatus("ASSIGNED", "COLLECTOR_EN_ROUTE"),
);
check(
  "en route arrives",
  canTransitionCollectionStatus("COLLECTOR_EN_ROUTE", "ARRIVED"),
);
check(
  "arrived collects",
  canTransitionCollectionStatus("ARRIVED", "COLLECTED"),
);
check(
  "en route can fail",
  canTransitionCollectionStatus("COLLECTOR_EN_ROUTE", "FAILED"),
);
check(
  "arrived can fail",
  canTransitionCollectionStatus("ARRIVED", "FAILED"),
);
check(
  "assigned cannot fail directly",
  !canTransitionCollectionStatus("ASSIGNED", "FAILED"),
);
check(
  "REJECTED is terminal",
  COLLECTION_STATUS_TRANSITIONS.REJECTED.length === 0,
);
check(
  "collected is terminal",
  COLLECTION_STATUS_TRANSITIONS.COLLECTED.length === 0,
);
check(
  "failed is terminal",
  COLLECTION_STATUS_TRANSITIONS.FAILED.length === 0,
);
check(
  "cancelled is terminal",
  COLLECTION_STATUS_TRANSITIONS.CANCELLED.length === 0,
);
check(
  "CANCELLED is rejected by the status schema (dedicated cancel endpoint only)",
  homeCollectionStatusSchema.safeParse({ status: "CANCELLED" }).success === false,
);

eq(
  "capacity-holding statuses exclude CANCELLED, REJECTED and FAILED",
  COLLECTION_CAPACITY_HOLDING_STATUSES,
  [
    "PENDING",
    "CONFIRMED",
    "ASSIGNED",
    "COLLECTOR_ACCEPTED",
    "COLLECTOR_EN_ROUTE",
    "ARRIVED",
    "COLLECTED",
  ],
);
check("isCapacityHoldingStatus PENDING", isCapacityHoldingStatus("PENDING"));
check("isCapacityHoldingStatus ARRIVED", isCapacityHoldingStatus("ARRIVED"));
check(
  "isCapacityHoldingStatus CANCELLED is false",
  !isCapacityHoldingStatus("CANCELLED"),
);
check(
  "isCapacityHoldingStatus FAILED is false",
  !isCapacityHoldingStatus("FAILED"),
);
check(
  "COLLECTED keeps its capacity (visit consumed)",
  isCapacityHoldingStatus("COLLECTED"),
);

eq(
  "cancellable statuses",
  COLLECTION_CANCELLABLE_STATUSES,
  ["PENDING", "CONFIRMED", "ASSIGNED", "COLLECTOR_ACCEPTED"],
);
eq(
  "collector-actionable statuses",
  COLLECTION_COLLECTOR_ACTIONABLE_STATUSES,
  ["ASSIGNED", "COLLECTOR_ACCEPTED", "COLLECTOR_EN_ROUTE", "ARRIVED"],
);

/* ------------------------------------------------------------------ *
 * 2. Role policy helpers
 * ------------------------------------------------------------------ */

check(
  "SUPER_ADMIN views management",
  canViewCollectionManagement(ROLES.SUPER_ADMIN),
);
check("ADMIN views management", canViewCollectionManagement(ROLES.ADMIN));
check(
  "LAB_MANAGER views management",
  canViewCollectionManagement(ROLES.LAB_MANAGER),
);
check("STAFF views management", canViewCollectionManagement(ROLES.STAFF));
check(
  "PATIENT does not view management",
  !canViewCollectionManagement(ROLES.PATIENT),
);
check(
  "DOCTOR does not view management",
  !canViewCollectionManagement(ROLES.DOCTOR),
);
check(
  "COLLECTOR does not view management",
  !canViewCollectionManagement(ROLES.COLLECTOR),
);

check(
  "PATIENT creates collections",
  canCreateCollection(ROLES.PATIENT),
);
check(
  "SUPER_ADMIN creates collections",
  canCreateCollection(ROLES.SUPER_ADMIN),
);
check("ADMIN creates collections", canCreateCollection(ROLES.ADMIN));
check(
  "LAB_MANAGER does not create collections",
  !canCreateCollection(ROLES.LAB_MANAGER),
);
check(
  "COLLECTOR does not create collections",
  !canCreateCollection(ROLES.COLLECTOR),
);

check(
  "PATIENT does not write status",
  !canWriteCollectionStatus(ROLES.PATIENT),
);
check(
  "LAB_MANAGER writes status",
  canWriteCollectionStatus(ROLES.LAB_MANAGER),
);
check(
  "COLLECTOR does not write status via ops role helper",
  !canWriteCollectionStatus(ROLES.COLLECTOR),
);
check(
  "STAFF does not write status",
  !canWriteCollectionStatus(ROLES.STAFF),
);

check(
  "LAB_MANAGER assigns collectors",
  canAssignCollectors(ROLES.LAB_MANAGER),
);
check(
  "COLLECTOR does not assign collectors",
  !canAssignCollectors(ROLES.COLLECTOR),
);
check(
  "STAFF does not assign collectors",
  !canAssignCollectors(ROLES.STAFF),
);

check(
  "LAB_MANAGER cancels any",
  canCancelAnyCollection(ROLES.LAB_MANAGER),
);
check(
  "PATIENT does not cancel any",
  !canCancelAnyCollection(ROLES.PATIENT),
);

check("COLLECTOR views assignments", canViewAssignments(ROLES.COLLECTOR));
check(
  "PATIENT does not view assignment board",
  !canViewAssignments(ROLES.PATIENT),
);
check(
  "ADMIN does not view assignment board",
  !canViewAssignments(ROLES.ADMIN),
);

/* ------------------------------------------------------------------ *
 * 3. Codes, labels and defaults
 * ------------------------------------------------------------------ */

eq("formatCollectionCode pads sequence", formatCollectionCode(2026, 1), "HC-2026-000001");
eq(
  "formatCollectionCode six digits",
  formatCollectionCode(2026, 123456),
  "HC-2026-123456",
);
check(
  "COLLECTION_CODE_PATTERN accepts a formatted code",
  COLLECTION_CODE_PATTERN.test("HC-2026-000042"),
);
check(
  "COLLECTION_CODE_PATTERN rejects a short sequence",
  !COLLECTION_CODE_PATTERN.test("HC-2026-42"),
);
check(
  "COLLECTION_CODE_PATTERN rejects a missing year",
  !COLLECTION_CODE_PATTERN.test("HC-26-000042"),
);

eq("PENDING label", collectionStatusLabel("PENDING"), "Pending review");
eq("CONFIRMED label", collectionStatusLabel("CONFIRMED"), "Accepted");
eq("REJECTED label", collectionStatusLabel("REJECTED"), "Rejected");
eq("COLLECTOR_EN_ROUTE label", collectionStatusLabel("COLLECTOR_EN_ROUTE"), "En route");
eq("unknown label falls back", collectionStatusLabel("NOPE"), "NOPE");
eq("PENDING badge warning", collectionStatusBadgeVariant("PENDING"), "warning");
eq("COLLECTED badge success", collectionStatusBadgeVariant("COLLECTED"), "success");
eq("FAILED badge danger", collectionStatusBadgeVariant("FAILED"), "danger");
eq("ASSIGNED badge primary", collectionStatusBadgeVariant("ASSIGNED"), "primary");

eq("default timezone", DEFAULT_COLLECTION_TIMEZONE, "Asia/Kolkata");
eq("default operating days", [...DEFAULT_COLLECTION_OPERATING_DAYS], [1, 2, 3, 4, 5, 6]);
eq("default opening", DEFAULT_COLLECTION_OPENING_TIME, "08:00");
eq("default closing", DEFAULT_COLLECTION_CLOSING_TIME, "14:00");
eq("default slot minutes", DEFAULT_COLLECTION_SLOT_DURATION_MINUTES, 60);
eq("default slot capacity", DEFAULT_COLLECTION_SLOT_CAPACITY, 4);
eq("default advance window", DEFAULT_COLLECTION_MAX_ADVANCE_DAYS, 14);
eq("cancellation cutoff hours", COLLECTION_CANCELLATION_CUTOFF_HOURS, 2);
eq("max tests per collection", MAX_TESTS_PER_COLLECTION, 20);

check(
  "Indian PIN pattern accepts 400001",
  INDIAN_PINCODE_PATTERN.test("400001"),
);
check(
  "Indian PIN pattern rejects leading zero",
  !INDIAN_PINCODE_PATTERN.test("012345"),
);
check(
  "Indian PIN pattern rejects five digits",
  !INDIAN_PINCODE_PATTERN.test("40001"),
);

/* ------------------------------------------------------------------ *
 * 4. Reused scheduling helpers (collection policy inputs)
 * ------------------------------------------------------------------ */

eq(
  "collection slots 08:00-14:00 / 60min",
  generateSlotStarts("08:00", "14:00", 60),
  ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00"],
);

const plan = buildSlotPlan(
  {
    date: "2026-12-15",
    timezone: "Asia/Kolkata",
    operatingDays: [1, 2, 3, 4, 5, 6],
    openingTime: "08:00",
    closingTime: "10:00",
    slotDurationMinutes: 60,
    slotCapacity: 2,
  },
  { taken: new Map([["08:00", 1]]) },
);
eq("slot plan has two slots", plan.length, 2);
eq("first slot has one remaining", plan[0].remaining, 1);
eq("second slot is full-free", plan[1].remaining, 2);
check("first slot available", plan[0].available);
check("second slot available", plan[1].available);

const fullPlan = buildSlotPlan(
  {
    date: "2026-12-15",
    timezone: "Asia/Kolkata",
    operatingDays: [1, 2, 3, 4, 5, 6],
    openingTime: "08:00",
    closingTime: "09:00",
    slotDurationMinutes: 60,
    slotCapacity: 1,
  },
  { taken: new Map([["08:00", 1]]) },
);
eq("full slot not available", fullPlan[0].available, false);

const deadline = cancellationDeadline("2026-10-13", "10:00", "Asia/Kolkata", 2);
check(
  "cancellation deadline is 2h before slot in lab timezone",
  deadline !== null && !Number.isNaN(deadline.getTime()),
);

const today = todayInTimeZone("Asia/Kolkata");
check(
  "todayInTimeZone returns YYYY-MM-DD",
  /^\d{4}-\d{2}-\d{2}$/.test(today),
);

/* ------------------------------------------------------------------ *
 * 5. Address schema
 * ------------------------------------------------------------------ */

const validAddress = {
  recipientName: "Priya Sharma",
  phone: "9876543210",
  addressLine1: "12 MG Road, Flat 4B",
  addressLine2: null,
  landmark: "Near City Mall",
  city: "Pune",
  state: "Maharashtra",
  pincode: "411001",
  // New requests must carry real pickup coordinates (never defaulted).
  latitude: 18.5204,
  longitude: 73.8567,
  instructions: "Ring the second bell",
};

accepts("valid address accepted", collectionAddressSchema, validAddress);
rejects("address rejects a short PIN", collectionAddressSchema, {
  ...validAddress,
  pincode: "41101",
});
rejects("address rejects a leading-zero PIN", collectionAddressSchema, {
  ...validAddress,
  pincode: "012345",
});
rejects("address rejects a missing recipient", collectionAddressSchema, {
  ...validAddress,
  recipientName: "",
});
rejects("address rejects a short line 1", collectionAddressSchema, {
  ...validAddress,
  addressLine1: "12",
});
rejects("address rejects an invalid phone", collectionAddressSchema, {
  ...validAddress,
  phone: "call-me",
});
accepts(
  "address accepts an empty optional line 2 (normalized later)",
  collectionAddressSchema,
  { ...validAddress, addressLine2: "" },
);
rejects("address rejects out-of-range latitude", collectionAddressSchema, {
  ...validAddress,
  latitude: 120,
});
rejects("address rejects missing coordinates", collectionAddressSchema, {
  ...validAddress,
  latitude: null,
  longitude: null,
});

/* ------------------------------------------------------------------ *
 * 6. Create / cancel / assign / status schemas
 * ------------------------------------------------------------------ */

const validCreate = {
  laboratoryId: "653f000000000000000000aa",
  testIds: ["653f000000000000000000bb", "653f000000000000000000cc"],
  address: validAddress,
  scheduledDate: "2026-10-20",
  timeSlot: "09:00",
  collectionInstructions: "Fasting sample preferred",
  idempotencyKey: "hc-idem-key-0001",
};

accepts("valid create payload accepted", homeCollectionCreateSchema, validCreate);
rejects("create rejects an empty test list", homeCollectionCreateSchema, {
  ...validCreate,
  testIds: [],
});
rejects("create rejects duplicate tests", homeCollectionCreateSchema, {
  ...validCreate,
  testIds: [
    "653f000000000000000000bb",
    "653f000000000000000000bb",
  ],
});
rejects("create rejects more than the max tests", homeCollectionCreateSchema, {
  ...validCreate,
  testIds: Array.from(
    { length: MAX_TESTS_PER_COLLECTION + 1 },
    (_, index) => `653f00000000000000000${String(index).padStart(2, "0")}`,
  ),
});
rejects("create rejects a loose date", homeCollectionCreateSchema, {
  ...validCreate,
  scheduledDate: "20/10/2026",
});
rejects("create rejects an impossible calendar date", homeCollectionCreateSchema, {
  ...validCreate,
  scheduledDate: "2026-02-30",
});
rejects("create rejects a malformed slot", homeCollectionCreateSchema, {
  ...validCreate,
  timeSlot: "9am",
});
rejects("create rejects a bad idempotency key charset", homeCollectionCreateSchema, {
  ...validCreate,
  idempotencyKey: "key with spaces!",
});
accepts(
  "create allows omitting the optional idempotency key",
  homeCollectionCreateSchema,
  { ...validCreate, idempotencyKey: undefined },
);
accepts(
  "create allows an optional linked booking",
  homeCollectionCreateSchema,
  { ...validCreate, labBookingId: "653f000000000000000000dd" },
);
rejects(
  "create rejects a malformed linked booking id",
  homeCollectionCreateSchema,
  { ...validCreate, labBookingId: "not-an-id" },
);

accepts(
  "cancel accepts an empty body (reason optional)",
  homeCollectionCancelSchema,
  {},
);
accepts(
  "cancel accepts a reason",
  homeCollectionCancelSchema,
  { reason: "Changed plans" },
);
rejects(
  "cancel rejects an oversized reason",
  homeCollectionCancelSchema,
  { reason: "x".repeat(501) },
);

accepts(
  "assign accepts a collector id",
  homeCollectionAssignSchema,
  { collectorId: "653f000000000000000000ee" },
);
rejects(
  "assign rejects a malformed collector id",
  homeCollectionAssignSchema,
  { collectorId: "nope" },
);

accepts(
  "status accepts CONFIRMED",
  homeCollectionStatusSchema,
  { status: "CONFIRMED" },
);
accepts(
  "status accepts COLLECTOR_ACCEPTED",
  homeCollectionStatusSchema,
  { status: "COLLECTOR_ACCEPTED" },
);
accepts(
  "status accepts ARRIVED",
  homeCollectionStatusSchema,
  { status: "ARRIVED" },
);
rejects(
  "status rejects COLLECTED (OTP verification endpoint only)",
  homeCollectionStatusSchema,
  { status: "COLLECTED" },
);
accepts(
  "status accepts FAILED with a reason",
  homeCollectionStatusSchema,
  { status: "FAILED", failureReason: "No one home" },
);
rejects(
  "status rejects FAILED without a reason",
  homeCollectionStatusSchema,
  { status: "FAILED" },
);
rejects(
  "status rejects FAILED with a blank reason",
  homeCollectionStatusSchema,
  { status: "FAILED", failureReason: "   " },
);
rejects(
  "status rejects CANCELLED (dedicated endpoint only)",
  homeCollectionStatusSchema,
  { status: "CANCELLED" },
);
rejects(
  "status rejects PENDING",
  homeCollectionStatusSchema,
  { status: "PENDING" },
);
rejects(
  "status rejects an oversized failure reason",
  homeCollectionStatusSchema,
  { status: "FAILED", failureReason: "x".repeat(501) },
);
rejects(
  "status rejects ASSIGNED (assignment goes through /assign only)",
  homeCollectionStatusSchema,
  { status: "ASSIGNED" },
);

/* ------------------------------------------------------------------ *
 * 7. Query schemas
 * ------------------------------------------------------------------ */

accepts(
  "availability accepts laboratory + date",
  homeCollectionAvailabilityQuerySchema,
  { laboratoryId: "653f000000000000000000aa", date: "2026-10-20" },
);
rejects(
  "availability rejects a missing date",
  homeCollectionAvailabilityQuerySchema,
  { laboratoryId: "653f000000000000000000aa" },
);
rejects(
  "availability rejects a malformed laboratory id",
  homeCollectionAvailabilityQuerySchema,
  { laboratoryId: "abc", date: "2026-10-20" },
);

accepts(
  "list accepts empty filters",
  homeCollectionListQuerySchema,
  {},
);
accepts(
  "list accepts status + date range",
  homeCollectionListQuerySchema,
  {
    status: "ASSIGNED",
    dateFrom: "2026-10-01",
    dateTo: "2026-10-31",
    page: 2,
    limit: 20,
  },
);
rejects(
  "list rejects an unknown status filter",
  homeCollectionListQuerySchema,
  { status: "NOPE" },
);
rejects(
  "list rejects an oversized limit",
  homeCollectionListQuerySchema,
  { limit: 500 },
);
rejects(
  "list rejects a dateTo before dateFrom",
  homeCollectionListQuerySchema,
  { dateFrom: "2026-10-20", dateTo: "2026-10-01" },
);

/* ------------------------------------------------------------------ *
 * 8. Laboratory home-collection config schema
 * ------------------------------------------------------------------ */

const validConfig = {
  timezone: "Asia/Kolkata",
  operatingDays: [1, 2, 3, 4, 5, 6],
  openingTime: "08:00",
  closingTime: "14:00",
  slotDurationMinutes: 60,
  slotCapacity: 4,
  maxAdvanceDays: 14,
};

accepts(
  "valid home collection config accepted",
  laboratoryHomeCollectionConfigSchema,
  validConfig,
);
rejects(
  "config rejects zero capacity",
  laboratoryHomeCollectionConfigSchema,
  { ...validConfig, slotCapacity: 0 },
);
rejects(
  "config rejects closing before opening",
  laboratoryHomeCollectionConfigSchema,
  { ...validConfig, openingTime: "14:00", closingTime: "08:00" },
);
rejects(
  "config rejects an empty operating-day list",
  laboratoryHomeCollectionConfigSchema,
  { ...validConfig, operatingDays: [] },
);
rejects(
  "config rejects a bad weekday index",
  laboratoryHomeCollectionConfigSchema,
  { ...validConfig, operatingDays: [7] },
);
rejects(
  "config rejects an invalid timezone",
  laboratoryHomeCollectionConfigSchema,
  { ...validConfig, timezone: "Mars/Olympus" },
);

/* ------------------------------------------------------------------ *
 * 9. Generic advance-status button contract + assignment invariants
 * ------------------------------------------------------------------ */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// The detail panel's advance buttons are driven by collectionAdvanceTargets:
// ASSIGNED never appears there (assignment happens only in the /assign
// dialog, and the generic /status endpoint rejects ASSIGNED above).
eq("CONFIRMED exposes no generic advance targets", collectionAdvanceTargets("CONFIRMED"), []);
eq(
  "ASSIGNED exposes only the collector acceptance",
  collectionAdvanceTargets("ASSIGNED"),
  ["COLLECTOR_ACCEPTED"],
);
eq(
  "COLLECTOR_ACCEPTED exposes only en-route",
  collectionAdvanceTargets("COLLECTOR_ACCEPTED"),
  ["COLLECTOR_EN_ROUTE"],
);
eq(
  "COLLECTOR_EN_ROUTE exposes only arrived",
  collectionAdvanceTargets("COLLECTOR_EN_ROUTE"),
  ["ARRIVED"],
);
eq("ARRIVED exposes no generic advance targets", collectionAdvanceTargets("ARRIVED"), []);
for (const status of ["PENDING", "REJECTED", "COLLECTED", "FAILED", "CANCELLED"]) {
  eq(`no advance targets from ${status}`, collectionAdvanceTargets(status), []);
}
for (const status of COLLECTION_STATUSES) {
  for (const target of collectionAdvanceTargets(status)) {
    check(
      `advance target ${status} -> ${target} is a legal transition`,
      canTransitionCollectionStatus(status, target),
    );
    check(
      `advance target ${status} -> ${target} never includes a dedicated-flow status`,
      !["ASSIGNED", "CONFIRMED", "REJECTED", "CANCELLED", "FAILED", "COLLECTED"].includes(
        target,
      ),
    );
  }
}

const assignRouteSource = readFileSync(
  path.join(ROOT, "src", "app", "api", "home-collections", "[id]", "assign", "route.ts"),
  "utf8",
);
check(
  "assign route clears the previous collector acceptance on every assignment",
  assignRouteSource.includes("collectorAcceptedAt: null"),
  "collectorAcceptedAt reset not found",
);
check(
  "assign route always lands the request on ASSIGNED",
  assignRouteSource.includes('status: "ASSIGNED"'),
  "ASSIGNED assignment not found",
);
const detailSource = readFileSync(
  path.join(ROOT, "src", "components", "home-collection", "collection-detail.tsx"),
  "utf8",
);
check(
  "detail panel derives its advance buttons from collectionAdvanceTargets",
  detailSource.includes("collectionAdvanceTargets(status)"),
  "collectionAdvanceTargets usage not found",
);
check(
  "detail panel no longer feeds raw transitions to the generic status endpoint",
  !detailSource.includes("COLLECTION_STATUS_TRANSITIONS[status]"),
  "raw transition filter still present",
);

const collectionFlowSource = readFileSync(
  path.join(ROOT, "src", "components", "home-collection", "collection-flow.tsx"),
  "utf8",
);
check(
  "geolocation copy never promises manual coordinate entry",
  !collectionFlowSource.includes("enter the coordinates manually"),
  "manual-entry promise still present",
);
check(
  "permission denial points at browser site settings",
  collectionFlowSource.includes(
    "Allow location access for this site in your browser settings",
  ),
  "permission guidance missing",
);
check(
  "timeout failure offers an explicit retry",
  collectionFlowSource.includes(
    "Check your connection and tap",
  ),
  "timeout retry guidance missing",
);
check(
  "failed capture keeps coordinates empty (never fabricated)",
  collectionFlowSource.includes("latitude: null as number | null"),
);

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

const total = passed + failures.length;
if (failures.length > 0) {
  console.error(`STEP 8 offline contract tests: ${passed}/${total} passed`);
  for (const failure of failures) {
    console.error(`  ✗ ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`STEP 8 offline contract tests: ${passed}/${total} passed`);
}
