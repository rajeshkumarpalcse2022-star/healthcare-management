/**
 * STEP 7 offline contract tests.
 *
 * Pure, DB-free verification of the online lab-booking module's shared
 * contracts: timezone/slot math, scheduling policy, status transitions,
 * role authorization helpers and the Zod request schemas.
 *
 * Run: npm run test:step7
 * (Node type-stripping + the `@/` resolve hook in register.mjs)
 */

import {
  addDaysToDateString,
  buildSlotPlan,
  cancellationDeadline,
  compareDateStrings,
  generateSlotStarts,
  isValidTimeZone,
  parseDateString,
  slotEnd,
  todayInTimeZone,
  weekdayOfDate,
  zonedWallClockToDate,
} from "@/lib/utils/booking-time";
import {
  BOOKING_CODE_PATTERN,
  BOOKING_REVIEWED_FILTER,
  BOOKING_STATUSES,
  bookingStatusLabel,
  canCancelAnyBooking,
  canCreateBooking,
  canCreateBookingForOthers,
  canTransitionBookingStatus,
  canViewBookingManagement,
  canWriteBookingStatus,
  formatBookingCode,
  bookingStatusBadgeVariant,
} from "@/config/lab-bookings";
import { ROLES } from "@/config/roles";
import {
  collectionRequestBadgeVariant,
  collectionRequestFilterLabel,
  collectionRequestHref,
  collectionRequestStatusLabel,
  COLLECTION_REQUEST_STATUSES,
} from "@/config/collection-requests";
import {
  labBookingAvailabilityQuerySchema,
  labBookingCancelSchema,
  labBookingCreateSchema,
  labBookingListQuerySchema,
  labBookingRejectSchema,
  labBookingStatusSchema,
} from "@/lib/validation/lab-booking";
import { collectionRequestListQuerySchema } from "@/lib/validation/collection-requests";
import { laboratoryBookingConfigSchema } from "@/lib/validation/laboratory";

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
  check(label, result.success, result.success ? "" : String(result.error.issues[0]));
}

/* ------------------------------------------------------------------ *
 * 1. Date / time helpers
 * ------------------------------------------------------------------ */

eq("parseDateString accepts a real date", parseDateString("2026-10-12"), {
  year: 2026,
  month: 10,
  day: 12,
});
check("parseDateString rejects 2026-02-30", parseDateString("2026-02-30") === null);
check("parseDateString rejects loose format", parseDateString("2026-1-01") === null);
check("parseDateString rejects text", parseDateString("tomorrow") === null);

eq("weekdayOfDate 2026-10-12 is Monday", weekdayOfDate("2026-10-12"), 1);
eq("weekdayOfDate 2026-10-11 is Sunday", weekdayOfDate("2026-10-11"), 0);
check("weekdayOfDate invalid -> null", weekdayOfDate("2026-13-40") === null);

eq("addDaysToDateString stays in month", addDaysToDateString("2026-10-12", 30), "2026-11-11");
eq("addDaysToDateString rolls over year", addDaysToDateString("2026-12-25", 10), "2027-01-04");

eq("compareDateStrings before", compareDateStrings("2026-10-11", "2026-10-12"), -1);
eq("compareDateStrings equal", compareDateStrings("2026-10-12", "2026-10-12"), 0);
eq("compareDateStrings after", compareDateStrings("2026-10-13", "2026-10-12"), 1);
check("compareDateStrings invalid -> null", compareDateStrings("bad", "2026-10-12") === null);

/* ------------------------------------------------------------------ *
 * 2. Slot generation
 * ------------------------------------------------------------------ */

eq(
  "generateSlotStarts 09:00-10:00 / 30min",
  generateSlotStarts("09:00", "10:00", 30),
  ["09:00", "09:30"],
);
eq(
  "generateSlotStarts excludes the closing boundary",
  generateSlotStarts("09:00", "11:00", 60),
  ["09:00", "10:00"],
);
eq(
  "generateSlotStarts empty when closing <= opening",
  generateSlotStarts("17:00", "09:00", 30),
  [],
);
eq(
  "generateSlotStarts empty for non-positive duration",
  generateSlotStarts("09:00", "17:00", 0),
  [],
);
eq("slotEnd rolls past midnight", slotEnd("23:45", 30), "00:15");
eq("slotEnd stays within the day", slotEnd("09:45", 30), "10:15");

/* ------------------------------------------------------------------ *
 * 3. Timezone math
 * ------------------------------------------------------------------ */

check("isValidTimeZone accepts Asia/Kolkata", isValidTimeZone("Asia/Kolkata"));
check("isValidTimeZone rejects garbage", !isValidTimeZone("Not/AZone"));
check("isValidTimeZone rejects empty", !isValidTimeZone(""));

eq(
  "zonedWallClockToDate converts IST wall-clock to UTC",
  zonedWallClockToDate("2026-10-13", "09:00", "Asia/Kolkata")?.toISOString(),
  "2026-10-13T03:30:00.000Z",
);
check(
  "zonedWallClockToDate rejects impossible date",
  zonedWallClockToDate("2026-02-30", "09:00", "Asia/Kolkata") === null,
);

eq(
  "todayInTimeZone rolls the day at the zone boundary",
  todayInTimeZone("Asia/Kolkata", new Date("2026-10-12T20:30:00.000Z")),
  "2026-10-13",
);

/* ------------------------------------------------------------------ *
 * 4. Slot plan (availability, capacity, past-slot exclusion)
 * ------------------------------------------------------------------ */

const PLAN = {
  date: "2026-10-13",
  timezone: "Asia/Kolkata",
  operatingDays: [1, 2, 3, 4, 5, 6],
  openingTime: "09:00",
  closingTime: "11:00",
  slotDurationMinutes: 30,
  slotCapacity: 3,
};
const PLAN_NOW = new Date("2026-10-13T00:00:00.000Z"); // before the first IST slot

const plan = buildSlotPlan(PLAN, { now: PLAN_NOW });
eq(
  "buildSlotPlan lists every future slot on an operating day",
  plan.map((entry) => entry.start),
  ["09:00", "09:30", "10:00", "10:30"],
);
eq(
  "buildSlotPlan marks untouched slots available",
  plan.every((entry) => entry.available && entry.remaining === 3),
  true,
);
eq("buildSlotPlan label shape", plan[0].label, "09:00 – 09:30");

const busyPlan = buildSlotPlan(PLAN, {
  now: PLAN_NOW,
  taken: new Map([["09:00", 3]]),
});
eq("buildSlotPlan full slot is unavailable", busyPlan[0].available, false);
eq("buildSlotPlan full slot remaining is zero", busyPlan[0].remaining, 0);
eq("buildSlotPlan other slots unaffected", busyPlan[1].remaining, 3);

eq(
  "buildSlotPlan empty on a non-operating day (Sunday)",
  buildSlotPlan({ ...PLAN, date: "2026-10-11" }, { now: PLAN_NOW }),
  [],
);
eq(
  "buildSlotPlan drops slots that already started",
  buildSlotPlan(PLAN, { now: new Date("2026-10-13T04:00:00.000Z") }).map(
    (entry) => entry.start,
  ),
  ["10:00", "10:30"],
);

/* ------------------------------------------------------------------ *
 * 5. Cancellation cutoff
 * ------------------------------------------------------------------ */

eq(
  "cancellationDeadline is cutoff hours before the IST slot start",
  cancellationDeadline("2026-10-13", "09:00", "Asia/Kolkata", 2)?.toISOString(),
  "2026-10-13T01:30:00.000Z",
);
check(
  "cancellationDeadline rejects bad input",
  cancellationDeadline("nope", "09:00", "Asia/Kolkata", 2) === null,
);

/* ------------------------------------------------------------------ *
 * 6. Status lifecycle and role policy
 * ------------------------------------------------------------------ */

eq("BOOKING_STATUSES has exactly five members", BOOKING_STATUSES.length, 5);
eq("initial status is PENDING", BOOKING_STATUSES.includes("PENDING"), true);
eq("review outcome REJECTED exists", BOOKING_STATUSES.includes("REJECTED"), true);

check("PENDING -> CONFIRMED allowed", canTransitionBookingStatus("PENDING", "CONFIRMED"));
check("PENDING -> REJECTED allowed", canTransitionBookingStatus("PENDING", "REJECTED"));
check("PENDING -> CANCELLED allowed", canTransitionBookingStatus("PENDING", "CANCELLED"));
check("PENDING -> COMPLETED rejected", !canTransitionBookingStatus("PENDING", "COMPLETED"));
check("CONFIRMED -> COMPLETED allowed", canTransitionBookingStatus("CONFIRMED", "COMPLETED"));
check("CONFIRMED -> CANCELLED allowed", canTransitionBookingStatus("CONFIRMED", "CANCELLED"));
check("CONFIRMED -> PENDING rejected", !canTransitionBookingStatus("CONFIRMED", "PENDING"));
check("CONFIRMED -> REJECTED rejected", !canTransitionBookingStatus("CONFIRMED", "REJECTED"));
check("REJECTED is terminal", !canTransitionBookingStatus("REJECTED", "CONFIRMED"));
check("REJECTED -> PENDING rejected", !canTransitionBookingStatus("REJECTED", "PENDING"));
check("CANCELLED is terminal", !canTransitionBookingStatus("CANCELLED", "CONFIRMED"));
check("COMPLETED is terminal", !canTransitionBookingStatus("COMPLETED", "CANCELLED"));

for (const role of [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.LAB_MANAGER, ROLES.STAFF]) {
  check(`${role} may view management bookings`, canViewBookingManagement(role));
}
check("PATIENT cannot view management bookings", !canViewBookingManagement(ROLES.PATIENT));
check("DOCTOR cannot view management bookings", !canViewBookingManagement(ROLES.DOCTOR));

check("LAB_MANAGER may write status", canWriteBookingStatus(ROLES.LAB_MANAGER));
check("STAFF may not write status", !canWriteBookingStatus(ROLES.STAFF));
check("PATIENT may not write status", !canWriteBookingStatus(ROLES.PATIENT));

check("ADMIN may cancel any booking", canCancelAnyBooking(ROLES.ADMIN));
check("STAFF may not cancel any booking", !canCancelAnyBooking(ROLES.STAFF));
check("PATIENT may not cancel others' bookings", !canCancelAnyBooking(ROLES.PATIENT));

check("PATIENT may create bookings", canCreateBooking(ROLES.PATIENT));
check("DOCTOR may not create bookings", !canCreateBooking(ROLES.DOCTOR));
check("ADMIN may create for others", canCreateBookingForOthers(ROLES.ADMIN));
check("LAB_MANAGER may not create for others", !canCreateBookingForOthers(ROLES.LAB_MANAGER));

eq(
  "formatBookingCode pads the sequence",
  formatBookingCode(2026, 7),
  "LAB-2026-000007",
);
check("formatBookingCode matches the code pattern", BOOKING_CODE_PATTERN.test(formatBookingCode(2026, 7)));
check("code pattern rejects malformed codes", !BOOKING_CODE_PATTERN.test("LAB-26-7"));

eq("badge variant for PENDING", bookingStatusBadgeVariant("PENDING"), "warning");
eq("badge variant for CONFIRMED", bookingStatusBadgeVariant("CONFIRMED"), "success");
eq("badge variant for REJECTED", bookingStatusBadgeVariant("REJECTED"), "danger");
eq("badge variant for CANCELLED", bookingStatusBadgeVariant("CANCELLED"), "neutral");
eq("badge variant for COMPLETED", bookingStatusBadgeVariant("COMPLETED"), "info");
eq("label for REJECTED", bookingStatusLabel("REJECTED"), "Rejected");
eq("label for PENDING reads as a review queue", bookingStatusLabel("PENDING"), "Pending review");

/* ------------------------------------------------------------------ *
 * 7. Create-booking schema
 * ------------------------------------------------------------------ */

const HEX = "507f1f77bcf86cd799439011";
const HEX2 = "507f1f77bcf86cd799439012";

const validCreate = {
  laboratoryId: HEX,
  testIds: [HEX, HEX2],
  bookingDate: "2026-11-01",
  timeSlot: "10:30",
  notes: "Fasting since morning.",
  contact: { phone: "+91 9876543210", email: "patient@example.com" },
  idempotencyKey: "idem-0123456789abcdef",
};
accepts("create schema accepts a complete payload", labBookingCreateSchema, validCreate);
accepts(
  "create schema accepts the minimal payload",
  labBookingCreateSchema,
  {
    laboratoryId: HEX,
    testIds: [HEX],
    bookingDate: "2026-11-01",
    timeSlot: "09:00",
  },
);

rejects("create schema rejects duplicate tests", labBookingCreateSchema, {
  ...validCreate,
  testIds: [HEX, HEX],
});
rejects("create schema rejects an empty test list", labBookingCreateSchema, {
  ...validCreate,
  testIds: [],
});
rejects("create schema rejects an impossible date", labBookingCreateSchema, {
  ...validCreate,
  bookingDate: "2026-02-30",
});
rejects("create schema rejects a malformed date", labBookingCreateSchema, {
  ...validCreate,
  bookingDate: "01-11-2026",
});
rejects("create schema rejects an HH:m slot", labBookingCreateSchema, {
  ...validCreate,
  timeSlot: "9:30",
});
rejects("create schema rejects an out-of-range slot", labBookingCreateSchema, {
  ...validCreate,
  timeSlot: "24:00",
});
rejects("create schema rejects over-long notes", labBookingCreateSchema, {
  ...validCreate,
  notes: "x".repeat(501),
});
rejects("create schema rejects an invalid laboratory id", labBookingCreateSchema, {
  ...validCreate,
  laboratoryId: "not-an-id",
});
rejects("create schema rejects a short idempotency key", labBookingCreateSchema, {
  ...validCreate,
  idempotencyKey: "short",
});
rejects("create schema rejects unsafe idempotency characters", labBookingCreateSchema, {
  ...validCreate,
  idempotencyKey: "key with spaces!",
});

/* ------------------------------------------------------------------ *
 * 8. Cancel / status / query schemas
 * ------------------------------------------------------------------ */

accepts("cancel schema accepts no reason", labBookingCancelSchema, {});
accepts("cancel schema accepts null reason", labBookingCancelSchema, { reason: null });
accepts(
  "cancel schema accepts a 500-char reason",
  labBookingCancelSchema,
  { reason: "r".repeat(500) },
);
rejects(
  "cancel schema rejects a 501-char reason",
  labBookingCancelSchema,
  { reason: "r".repeat(501) },
);

accepts("status schema accepts CONFIRMED", labBookingStatusSchema, { status: "CONFIRMED" });
accepts("status schema accepts COMPLETED", labBookingStatusSchema, { status: "COMPLETED" });
rejects("status schema rejects CANCELLED", labBookingStatusSchema, { status: "CANCELLED" });
rejects("status schema rejects PENDING", labBookingStatusSchema, { status: "PENDING" });
rejects("status schema rejects REJECTED as a target", labBookingStatusSchema, {
  status: "REJECTED",
});

accepts("reject schema accepts a reason", labBookingRejectSchema, {
  reason: "Tests unavailable at this laboratory.",
});
rejects("reject schema requires a reason", labBookingRejectSchema, {});
rejects("reject schema rejects a too-short reason", labBookingRejectSchema, {
  reason: "no",
});
rejects("reject schema rejects a 501-char reason", labBookingRejectSchema, {
  reason: "r".repeat(501),
});

accepts("availability query accepts a real pair", labBookingAvailabilityQuerySchema, {
  laboratoryId: HEX,
  date: "2026-11-01",
});
rejects("availability query rejects a bad date", labBookingAvailabilityQuerySchema, {
  laboratoryId: HEX,
  date: "soon",
});

accepts("list query applies defaults", labBookingListQuerySchema, {});
eq(
  "list query defaults status to all",
  labBookingListQuerySchema.parse({}).status,
  "all",
);
accepts("list query accepts a booking-reference search", labBookingListQuerySchema, {
  search: "LAB-2026-000001",
});
rejects("list query rejects punctuation in search", labBookingListQuerySchema, {
  search: "LAB/2026",
});
rejects("list query rejects unknown status", labBookingListQuerySchema, {
  status: "BOGUS",
});
accepts("list query accepts the REVIEWED pseudo-filter", labBookingListQuerySchema, {
  status: BOOKING_REVIEWED_FILTER,
});

/* ------------------------------------------------------------------ *
 * 9. Laboratory booking-configuration schema
 * ------------------------------------------------------------------ */

const validConfig = {
  timezone: "Asia/Kolkata",
  operatingDays: [1, 2, 3, 4, 5, 6],
  openingTime: "09:00",
  closingTime: "17:00",
  slotDurationMinutes: 30,
  slotCapacity: 3,
  maxAdvanceDays: 30,
};
accepts("booking config accepts the defaults", laboratoryBookingConfigSchema, validConfig);

const closingIssue = laboratoryBookingConfigSchema.safeParse({
  ...validConfig,
  closingTime: "09:00",
});
check(
  "booking config requires closing after opening",
  !closingIssue.success &&
    closingIssue.error.issues[0].path.join(".") === "closingTime",
);

rejects("booking config rejects an invalid timezone", laboratoryBookingConfigSchema, {
  ...validConfig,
  timezone: "Mars/Olympus",
});
rejects("booking config rejects duplicate operating days", laboratoryBookingConfigSchema, {
  ...validConfig,
  operatingDays: [1, 1, 2],
});
rejects("booking config rejects an empty day list", laboratoryBookingConfigSchema, {
  ...validConfig,
  operatingDays: [],
});
rejects("booking config rejects a bad weekday index", laboratoryBookingConfigSchema, {
  ...validConfig,
  operatingDays: [7],
});
rejects("booking config rejects an HH:mm opening time", laboratoryBookingConfigSchema, {
  ...validConfig,
  openingTime: "9am",
});
rejects("booking config rejects a sub-minimum slot duration", laboratoryBookingConfigSchema, {
  ...validConfig,
  slotDurationMinutes: 10,
});
rejects("booking config rejects an oversized slot duration", laboratoryBookingConfigSchema, {
  ...validConfig,
  slotDurationMinutes: 600,
});
rejects("booking config rejects zero capacity", laboratoryBookingConfigSchema, {
  ...validConfig,
  slotCapacity: 0,
});
rejects("booking config rejects a zero advance window", laboratoryBookingConfigSchema, {
  ...validConfig,
  maxAdvanceDays: 0,
});
rejects("booking config rejects an oversized advance window", laboratoryBookingConfigSchema, {
  ...validConfig,
  maxAdvanceDays: 365,
});

/* ------------------------------------------------------------------ *
 * 10. Central Collection Requests queue contracts
 * ------------------------------------------------------------------ */

eq(
  "queue status union covers both lifecycles (11 statuses)",
  COLLECTION_REQUEST_STATUSES.length,
  11,
);
eq(
  "queue union includes the booking review outcome",
  COLLECTION_REQUEST_STATUSES.includes("REJECTED"),
  true,
);
eq(
  "queue union includes the collector states",
  COLLECTION_REQUEST_STATUSES.includes("ASSIGNED"),
  true,
);

eq(
  "queue labels keep booking wording for lab visits",
  collectionRequestStatusLabel("LAB_VISIT", "CONFIRMED"),
  "Confirmed",
);
eq(
  "queue labels keep collection wording for home collections",
  collectionRequestStatusLabel("HOME_COLLECTION", "CONFIRMED"),
  "Accepted",
);
eq(
  "queue filter label merges the shared confirmation wording",
  collectionRequestFilterLabel("CONFIRMED"),
  "Confirmed / Accepted",
);
eq(
  "queue badge variant delegates per type (booking REJECTED)",
  collectionRequestBadgeVariant("LAB_VISIT", "REJECTED"),
  "danger",
);
eq(
  "queue badge variant delegates per type (collection ASSIGNED)",
  collectionRequestBadgeVariant("HOME_COLLECTION", "ASSIGNED"),
  "primary",
);
eq(
  "queue href routes lab visits to the booking detail",
  collectionRequestHref("LAB_VISIT", "abc123"),
  "/lab-bookings/abc123",
);
eq(
  "queue href routes home collections to the collection detail",
  collectionRequestHref("HOME_COLLECTION", "abc123"),
  "/home-collections/abc123",
);

accepts("queue query applies defaults", collectionRequestListQuerySchema, {});
eq(
  "queue query defaults to every type and status",
  `${collectionRequestListQuerySchema.parse({}).type}/${collectionRequestListQuerySchema.parse({}).status}`,
  "all/all",
);
accepts("queue query accepts both request types", collectionRequestListQuerySchema, {
  type: "HOME_COLLECTION",
});
rejects("queue query rejects an unknown request type", collectionRequestListQuerySchema, {
  type: "PHONE_CALL",
});
accepts("queue query accepts a date range", collectionRequestListQuerySchema, {
  dateFrom: "2026-10-01",
  dateTo: "2026-10-31",
});
rejects("queue query rejects an inverted date range", collectionRequestListQuerySchema, {
  dateFrom: "2026-10-31",
  dateTo: "2026-10-01",
});
rejects("queue query rejects a malformed date", collectionRequestListQuerySchema, {
  dateFrom: "31-10-2026",
});

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

const total = passed + failures.length;
if (failures.length > 0) {
  console.error(`STEP 7 offline contract tests: ${passed}/${total} passed`);
  for (const failure of failures) {
    console.error(`  ✗ ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(`STEP 7 offline contract tests: ${passed}/${total} passed`);
}
