/**
 * STEP 9 offline contract tests - authentication (sign up / sign in) and
 * role navigation entry points.
 *
 * Pure, DB-free verification of the registration and login contracts:
 * the register schema (self-signup role allow-list, password policy,
 * confirm-password match), the login schema, email normalisation,
 * post-login redirect sanitisation, the role-to-dashboard route map used
 * by the login and register endpoints, and the sidebar navigation source
 * of truth (role link targets, the patient booking entry point, and the
 * collector surface list).
 *
 * Run: npm run test:step9
 * (Node type-stripping + the `@/` resolve hook in register.mjs)
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_POST_LOGIN_ROUTE,
  ROLE_DASHBOARD_ROUTES,
  SIGNUP_ROUTE,
  LOGIN_ROUTE,
  getDashboardRouteForRole,
} from "@/config/auth";
import { ROLES, ROLE_VALUES, PROVISIONABLE_ROLES, isRole, roleLabel } from "@/config/roles";
import {
  PUBLIC_SIGNUP_ROLES,
  loginSchema,
  normalizeEmail,
  registerSchema,
  sanitizeNextPath,
} from "@/lib/validation/auth";
import { AuthError, InfrastructureError, isAuthError } from "@/lib/auth/errors";
import {
  SCOPED_ROLES,
  isLaboratoryInScope,
  resolveLaboratoryScope,
  scopeFilter,
} from "@/lib/auth/laboratory-scope";
import {
  userCreateSchema,
  userPatchSchema,
} from "@/lib/validation/user-scope";
import {
  doctorCreateSchema,
  doctorStatusSchema,
  doctorUpdateSchema,
} from "@/lib/validation/doctor";
import {
  clinicCreateSchema,
  clinicStatusSchema,
  clinicUpdateSchema,
} from "@/lib/validation/clinic";
import { parameterCreateSchema } from "@/lib/validation/lab-test-parameter";
import {
  PATIENT_BLOOD_GROUPS,
  PATIENT_GENDERS,
  PATIENT_NOTES_MAX_LENGTH,
} from "@/config/patients";
import {
  patientCreateSchema,
  patientDateStringSchema,
  patientListQuerySchema,
  patientPatchSchema,
  patientSelfPutSchema,
  patientStatusSchema,
} from "@/lib/validation/patient";
import {
  INVOICEABLE_BOOKING_STATUSES,
  INVOICEABLE_COLLECTION_STATUSES,
  INVOICE_CODE_PATTERN,
  INVOICE_STATUSES,
  INVOICE_TRANSITIONS,
  MAX_INVOICE_ITEMS,
  MAX_ITEM_QUANTITY,
  MAX_ITEM_UNIT_PRICE,
  PAYMENT_CODE_PATTERN,
  PAYMENT_KINDS,
  formatInvoiceCode,
  formatPaymentCode,
} from "@/config/billing";
import { money, moneyEquals } from "@/lib/billing/money";
import {
  isFullyRefunded,
  isFullySettled,
  netPaid,
  outstandingBalance,
} from "@/lib/billing/balance";
import { toInvoiceDto } from "@/lib/billing/dto";
import {
  invoiceCreateSchema,
  invoiceListQuerySchema,
  invoiceUpdateSchema,
  paymentCreateSchema,
} from "@/lib/validation/billing";

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

/* ------------------------------------------------------------------ *
 * Public sign-up role allow-list
 * ------------------------------------------------------------------ */

eq("PUBLIC_SIGNUP_ROLES is exactly PATIENT + DOCTOR", PUBLIC_SIGNUP_ROLES, [
  "PATIENT",
  "DOCTOR",
]);

check(
  "privileged roles are NOT in PUBLIC_SIGNUP_ROLES",
  !PUBLIC_SIGNUP_ROLES.some((role) =>
    [
      ROLES.SUPER_ADMIN,
      ROLES.ADMIN,
      ROLES.LAB_MANAGER,
      ROLES.STAFF,
      ROLES.COLLECTOR,
    ].includes(role),
  ),
);

/* ------------------------------------------------------------------ *
 * registerSchema - happy paths
 * ------------------------------------------------------------------ */

const validPatient = {
  name: "Jane Patient",
  email: "jane@example.com",
  phone: "+91 98765 43210",
  password: "correct-horse-battery",
  confirmPassword: "correct-horse-battery",
  role: "PATIENT",
};

const validDoctor = {
  name: "Dr House",
  email: "house@clinic.com",
  password: "secure-passphrase-1",
  confirmPassword: "secure-passphrase-1",
  role: "DOCTOR",
};

const patientParsed = registerSchema.safeParse(validPatient);
check("valid PATIENT registration passes", patientParsed.success);

const doctorParsed = registerSchema.safeParse(validDoctor);
check("valid DOCTOR registration passes", doctorParsed.success);

check(
  "phone is optional for registration",
  registerSchema.safeParse({ ...validDoctor }).success,
);

const emptyPhoneParsed = registerSchema.safeParse({
  ...validPatient,
  phone: "",
});
check("empty-string phone is accepted", emptyPhoneParsed.success);

/* ------------------------------------------------------------------ *
 * registerSchema - privileged / management roles are rejected
 * ------------------------------------------------------------------ */

for (const role of [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
  ROLES.COLLECTOR,
]) {
  const parsed = registerSchema.safeParse({ ...validPatient, role });
  check(`role ${role} is rejected at sign-up`, !parsed.success);
  if (!parsed.success) {
    const roleIssue = parsed.error.issues.some(
      (issue) => issue.path[0] === "role",
    );
    check(`role ${role} rejection is attributed to the role field`, roleIssue);
  }
}

/* ------------------------------------------------------------------ *
 * registerSchema - password policy and confirm match
 * ------------------------------------------------------------------ */

const shortPassword = registerSchema.safeParse({
  ...validPatient,
  password: "short",
  confirmPassword: "short",
});
check("password shorter than 8 chars is rejected", !shortPassword.success);

const mismatch = registerSchema.safeParse({
  ...validPatient,
  password: "correct-horse-battery",
  confirmPassword: "different-password",
});
check("password/confirmPassword mismatch is rejected", !mismatch.success);
if (!mismatch.success) {
  const onConfirm = mismatch.error.issues.some(
    (issue) => issue.path[0] === "confirmPassword",
  );
  check("mismatch is attributed to confirmPassword", onConfirm);
}

/* ------------------------------------------------------------------ *
 * registerSchema - field constraints
 * ------------------------------------------------------------------ */

const badEmail = registerSchema.safeParse({
  ...validPatient,
  email: "not-an-email",
});
check("invalid email is rejected", !badEmail.success);

const shortName = registerSchema.safeParse({
  ...validPatient,
  name: "J",
});
check("name shorter than 2 chars is rejected", !shortName.success);

const trimmed = registerSchema.safeParse({
  ...validPatient,
  name: "  Jane Patient  ",
  email: "  Jane@Example.COM  ",
});
check("valid payload with padded fields passes", trimmed.success);
if (trimmed.success) {
  eq("name is trimmed by the schema", trimmed.data.name, "Jane Patient");
  eq(
    "email is lowercased + trimmed by normalise helper",
    normalizeEmail(trimmed.data.email),
    "jane@example.com",
  );
}

/* ------------------------------------------------------------------ *
 * loginSchema (unchanged behaviour, re-verified)
 * ------------------------------------------------------------------ */

const loginParsed = loginSchema.safeParse({
  email: "jane@example.com",
  password: "correct-horse-battery",
});
check("valid login payload passes", loginParsed.success);
if (loginParsed.success) {
  eq("rememberMe defaults to false", loginParsed.data.rememberMe, false);
}

const loginBadEmail = loginSchema.safeParse({
  email: "nope",
  password: "x",
});
check("login rejects invalid email", !loginBadEmail.success);

/* ------------------------------------------------------------------ *
 * normalizeEmail
 * ------------------------------------------------------------------ */

eq("normalizeEmail lowercases", normalizeEmail("JANE@EXAMPLE.COM"), "jane@example.com");
eq("normalizeEmail trims", normalizeEmail("  jane@example.com  "), "jane@example.com");

/* ------------------------------------------------------------------ *
 * sanitizeNextPath - open-redirect guards
 * ------------------------------------------------------------------ */

eq("sanitizeNextPath accepts same-origin path", sanitizeNextPath("/dashboard"), "/dashboard");
eq(
  "sanitizeNextPath accepts path with query",
  sanitizeNextPath("/patients?page=2"),
  "/patients?page=2",
);
eq("sanitizeNextPath rejects protocol-relative URL", sanitizeNextPath("//evil.com"), null);
eq("sanitizeNextPath rejects backslash variant", sanitizeNextPath("/\\evil.com"), null);
eq("sanitizeNextPath rejects API paths", sanitizeNextPath("/api/auth/login"), null);
eq("sanitizeNextPath rejects absolute URLs", sanitizeNextPath("https://evil.com"), null);
eq("sanitizeNextPath rejects empty string", sanitizeNextPath(""), null);
eq("sanitizeNextPath rejects non-strings", sanitizeNextPath(undefined), null);
eq("sanitizeNextPath rejects oversized values", sanitizeNextPath("/" + "a".repeat(2000)), null);

/* ------------------------------------------------------------------ *
 * Role -> dashboard route map (required redirects)
 * ------------------------------------------------------------------ */

eq(
  "SUPER_ADMIN dashboard route",
  getDashboardRouteForRole(ROLES.SUPER_ADMIN),
  "/super-admin/dashboard",
);
eq("ADMIN dashboard route", getDashboardRouteForRole(ROLES.ADMIN), "/admin/dashboard");
eq("DOCTOR dashboard route", getDashboardRouteForRole(ROLES.DOCTOR), "/doctor/dashboard");
eq(
  "LAB_MANAGER dashboard route",
  getDashboardRouteForRole(ROLES.LAB_MANAGER),
  "/lab-manager/dashboard",
);
eq("STAFF dashboard route", getDashboardRouteForRole(ROLES.STAFF), "/staff/dashboard");
eq("PATIENT dashboard route", getDashboardRouteForRole(ROLES.PATIENT), "/patient/dashboard");
eq(
  "COLLECTOR dashboard route",
  getDashboardRouteForRole(ROLES.COLLECTOR),
  "/collector/dashboard",
);

check(
  "ROLE_DASHBOARD_ROUTES covers every registered role",
  ROLE_VALUES.every((role) => typeof ROLE_DASHBOARD_ROUTES[role] === "string"),
);

check(
  "every role dashboard route is under its role segment",
  ROLE_VALUES.every((role) =>
    ROLE_DASHBOARD_ROUTES[role].startsWith(
      "/" + role.toLowerCase().replace(/_/g, "-") + "/",
    ),
  ),
);

/* ------------------------------------------------------------------ *
 * Auth route constants
 * ------------------------------------------------------------------ */

eq("LOGIN_ROUTE is /login", LOGIN_ROUTE, "/login");
eq("SIGNUP_ROUTE is /signup", SIGNUP_ROUTE, "/signup");
eq(
  "DEFAULT_POST_LOGIN_ROUTE stays /dashboard",
  DEFAULT_POST_LOGIN_ROUTE,
  "/dashboard",
);

/* ------------------------------------------------------------------ *
 * Role helpers (used by dashboards + navigation filtering)
 * ------------------------------------------------------------------ */

check("isRole accepts every registered role", ROLE_VALUES.every(isRole));
check("isRole rejects unknown values", !isRole("HACKER"));
eq("roleLabel maps PATIENT", roleLabel(ROLES.PATIENT), "Patient");
eq("roleLabel maps COLLECTOR", roleLabel(ROLES.COLLECTOR), "Collector");

/* ------------------------------------------------------------------ *
 * Role navigation entry points (sidebar source of truth)
 *
 * navigation.ts cannot be imported here (it pulls in JSX icons), so these
 * checks read the source directly and parse the roleNavigation sections.
 * ------------------------------------------------------------------ */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const navSource = readFileSync(path.join(ROOT, "src", "config", "navigation.ts"), "utf8");

/** Source slice of one top-level `ROLE: [` section inside roleNavigation. */
function roleSectionSource(role) {
  const keys = [...navSource.matchAll(/^  ([A-Z_]+): \[$/gm)];
  const index = keys.findIndex((match) => match[1] === role);
  check(`navigation source has a ${role} section`, index !== -1);
  if (index === -1) return "";
  const start = keys[index].index;
  const end = index + 1 < keys.length ? keys[index + 1].index : navSource.length;
  return navSource.slice(start, end);
}

/** href registered for an item label inside a section (null when absent). */
function labelHref(section, label) {
  const match = section.match(
    new RegExp(`label: "${label}",\\s*href: "([^"]+)"`),
  );
  return match ? match[1] : null;
}

const labManagerNav = roleSectionSource("LAB_MANAGER");
eq(
  "LAB_MANAGER Online Booking opens the management list",
  labelHref(labManagerNav, "Online Booking"),
  "/lab-bookings",
);

const staffNav = roleSectionSource("STAFF");
eq(
  "STAFF Online Booking opens the management list",
  labelHref(staffNav, "Online Booking"),
  "/lab-bookings",
);

const patientNav = roleSectionSource("PATIENT");
eq(
  "PATIENT Book a Test opens the choice page",
  labelHref(patientNav, "Book a Test"),
  "/book-a-test",
);
check(
  "PATIENT Book a Test lights up both flow routes",
  patientNav.includes('activeHrefs: ["/bookings", "/home-collection"]'),
  "activeHrefs not found on the patient booking entry",
);
check(
  "PATIENT sidebar never links a single booking flow directly",
  !patientNav.includes('href: "/bookings"') &&
    !patientNav.includes('href: "/home-collection"'),
  "raw flow link leaked into the patient sidebar",
);

const collectorNav = roleSectionSource("COLLECTOR");
check(
  "COLLECTOR sidebar has no Available Pickups dead end",
  !collectorNav.includes("Available Pickups"),
  "Available Pickups still present",
);
eq(
  "COLLECTOR reaches work only through My Assignments",
  labelHref(collectorNav, "My Assignments"),
  "/my-assignments",
);
check(
  "COLLECTOR section keeps a dashboard entry",
  labelHref(collectorNav, "Dashboard") === "/collector/dashboard",
);

// Base navigation still feeds ADMIN/SUPER_ADMIN the patient create flow
// (both roles may create bookings directly).
check(
  "base navigation keeps the create-flow Online Booking link",
  /label: "Online Booking",\s*href: "\/bookings"/.test(navSource),
  "base Online Booking link missing",
);

const bookATestSource = readFileSync(
  path.join(ROOT, "src", "app", "(dashboard)", "book-a-test", "page.tsx"),
  "utf8",
);
check(
  "book-a-test page offers the lab-visit flow",
  bookATestSource.includes('href: "/bookings"'),
  "lab-visit card missing",
);
check(
  "book-a-test page offers the home-collection flow",
  bookATestSource.includes('href: "/home-collection"'),
  "home-collection card missing",
);

const sidebarNavSource = readFileSync(
  path.join(ROOT, "src", "components", "layout", "sidebar-nav.tsx"),
  "utf8",
);
check(
  "sidebar active state honours activeHrefs aliases",
  sidebarNavSource.includes("isNavigationItemActive(pathname, item)"),
  "isNavigationItemActive not wired into the sidebar",
);

const patientDashboardSource = readFileSync(
  path.join(ROOT, "src", "app", "(dashboard)", "patient", "dashboard", "page.tsx"),
  "utf8",
);
check(
  "patient dashboard Book a Test card opens the choice page",
  /label: "Book a Test",\s*href: "\/book-a-test"/.test(patientDashboardSource),
  "patient dashboard card not updated",
);

const labManagerDashboardSource = readFileSync(
  path.join(ROOT, "src", "app", "(dashboard)", "lab-manager", "dashboard", "page.tsx"),
  "utf8",
);
check(
  "lab-manager dashboard quick link opens the management list",
  /label: "Online Bookings",\s*href: "\/lab-bookings"/.test(labManagerDashboardSource),
  "lab-manager dashboard quick link not updated",
);

const collectorDashboardSource = readFileSync(
  path.join(ROOT, "src", "app", "(dashboard)", "collector", "dashboard", "page.tsx"),
  "utf8",
);
check(
  "collector dashboard has no Available Pickups dead end",
  !collectorDashboardSource.includes("Available Pickups"),
  "collector dashboard still shows Available Pickups",
);

/* ------------------------------------------------------------------ *
 * Phase 2 role dashboards (source contracts)
 *
 * The widgets are client components, so these checks read their sources
 * directly: every data section must go through the existing list APIs via
 * useApiList (never a raw fetch), each dashboard keeps its guard and its
 * required action links, and no placeholder copy survives.
 * ------------------------------------------------------------------ */

const readSrc = (...parts) => readFileSync(path.join(ROOT, ...parts), "utf8");

const patientWidgetSource = readSrc(
  "src", "components", "dashboards", "patient-dashboard.tsx",
);
check(
  "patient widgets fetch the existing bookings list API",
  patientWidgetSource.includes('"/api/lab-bookings?limit=25"'),
  "bookings query missing",
);
check(
  "patient widgets scope pickups with the existing dateFrom filter",
  patientWidgetSource.includes(
    "`/api/home-collections?dateFrom=${today}&limit=6`",
  ),
  "collections query missing",
);
check(
  "patient widgets use the shared useApiList hook",
  patientWidgetSource.includes("useApiList"),
  "useApiList not wired in",
);
check(
  "patient widgets shape rows with the pure helpers",
  patientWidgetSource.includes("pickUpcomingBookings(") &&
    patientWidgetSource.includes("pickUpcomingCollections("),
  "row helpers not used",
);
check(
  "patient widgets never issue a raw fetch",
  !/fetch\(/.test(patientWidgetSource),
  "raw fetch found",
);

check(
  "patient dashboard offers My Appointments",
  /label: "My Appointments",\s*href: "\/my-appointments"/.test(patientDashboardSource),
  "My Appointments link missing",
);
check(
  "patient dashboard offers Home Sample Collection",
  /label: "Home Sample Collection",\s*href: "\/home-collection"/.test(patientDashboardSource),
  "Home Sample Collection link missing",
);
check(
  "patient dashboard offers My Profile",
  /label: "My Profile",\s*href: "\/profile"/.test(patientDashboardSource),
  "My Profile link missing",
);
check(
  "patient dashboard placeholder activity card is gone",
  !patientDashboardSource.includes("Your recent activity"),
  "placeholder still rendered",
);
check(
  "patient dashboard renders the live widgets",
  patientDashboardSource.includes("<PatientDashboardWidgets />"),
  "widgets not mounted",
);

const lmWidgetSource = readSrc(
  "src", "components", "dashboards", "lab-manager-dashboard.tsx",
);
check(
  "lab-manager pending widget queries the queue status filter",
  lmWidgetSource.includes(
    '"/api/collection-requests?status=PENDING&limit=5"',
  ),
  "pending queue query missing",
);
check(
  "lab-manager today widgets filter the queue by type and date",
  lmWidgetSource.includes(
    "`/api/collection-requests?type=LAB_VISIT&dateFrom=${today}&dateTo=${today}&limit=5`",
  ) &&
    lmWidgetSource.includes(
      "`/api/collection-requests?type=HOME_COLLECTION&dateFrom=${today}&dateTo=${today}&limit=5`",
    ),
  "today queue queries missing",
);
check(
  "lab-manager widgets badge queue rows type-aware",
  lmWidgetSource.includes("queueRowStatusBadge("),
  "type-aware badge helper not used",
);
check(
  "lab-manager widgets never issue a raw fetch",
  !/fetch\(/.test(lmWidgetSource),
  "raw fetch found",
);

check(
  "lab-manager dashboard links the review queue",
  /label: "Review queue",\s*href: "\/home-collections\/manage\?view=requests"/.test(
    labManagerDashboardSource,
  ),
  "review queue link missing",
);
check(
  "lab-manager dashboard links the collections management view",
  /label: "Home Collections",\s*href: "\/home-collections\/manage\?view=collections"/.test(
    labManagerDashboardSource,
  ),
  "collections view link missing",
);
check(
  "lab-manager dashboard links the tests catalogue",
  /label: "Lab Tests",\s*href: "\/lab\?tab=tests"/.test(labManagerDashboardSource),
  "Lab Tests link missing",
);
check(
  "lab-manager dashboard offers no patient create-flow link",
  !labManagerDashboardSource.includes('href: "/bookings"'),
  "href=/bookings leaked into the lab-manager dashboard",
);
check(
  "lab-manager dashboard placeholder operations card is gone",
  !labManagerDashboardSource.includes("Lab operations today"),
  "placeholder still rendered",
);
check(
  "lab-manager dashboard renders the live widgets",
  labManagerDashboardSource.includes("<LabManagerDashboardWidgets />"),
  "widgets not mounted",
);

const collectorWidgetSource = readSrc(
  "src", "components", "dashboards", "collector-dashboard.tsx",
);
check(
  "collector today widget queries today's assigned pickups",
  collectorWidgetSource.includes(
    "`/api/home-collections?dateFrom=${today}&dateTo=${today}&limit=6`",
  ),
  "today pickups query missing",
);
check(
  "collector assignments widget reads the scoped assignment list",
  collectorWidgetSource.includes('"/api/home-collections?limit=8"'),
  "assignments query missing",
);
check(
  "collector widget counts exact awaitings via the status filter",
  collectorWidgetSource.includes(
    '"/api/home-collections?status=ASSIGNED&limit=1"',
  ),
  "awaiting-acceptance query missing",
);
check(
  "collector widgets never issue a raw fetch",
  !/fetch\(/.test(collectorWidgetSource),
  "raw fetch found",
);
check(
  "collector widget surface has no Available Pickups / claim copy",
  !collectorWidgetSource.includes("Available Pickups") &&
    !/claim/i.test(collectorWidgetSource),
  "claim workflow leaked into the dashboard",
);
check(
  "collector dashboard renders the live widgets",
  collectorDashboardSource.includes("<CollectorDashboardWidgets />"),
  "widgets not mounted",
);
check(
  "collector dashboard placeholder route card is gone",
  !collectorDashboardSource.includes("Today's route"),
  "placeholder still rendered",
);

const sharedWidgetSource = readSrc(
  "src", "components", "dashboards", "shared-dashboard.tsx",
);
check(
  "widget shell is a client component",
  sharedWidgetSource.startsWith('"use client";'),
  "missing use client directive",
);
check(
  "widget shell covers loading, error and empty states",
  sharedWidgetSource.includes("Skeleton") &&
    sharedWidgetSource.includes("ErrorState") &&
    sharedWidgetSource.includes("EmptyState"),
  "state coverage incomplete",
);

/* ------------------------------------------------------------------ *
 * My Profile surface (Phase 2)
 * ------------------------------------------------------------------ */

const profilePageSource = readSrc(
  "src", "app", "(dashboard)", "profile", "page.tsx",
);
check(
  "profile page reads the verified session user",
  profilePageSource.includes("getCurrentUser"),
  "getCurrentUser not used",
);
check(
  "profile page renders the role label",
  profilePageSource.includes("roleLabel("),
  "role label missing",
);
check(
  "profile page introduces no API call",
  !/fetch\(/.test(profilePageSource) && !profilePageSource.includes("/api/"),
  "profile page calls an API",
);

const userMenuSource = readSrc(
  "src", "components", "layout", "user-menu.tsx",
);
check(
  "account menu links to the profile page",
  userMenuSource.includes('router.push("/profile")'),
  "profile menu item missing",
);

const labPageSource = readSrc("src", "app", "(dashboard)", "lab", "page.tsx");
check(
  "lab page validates ?tab= deep links",
  labPageSource.includes("searchParams") &&
    labPageSource.includes("TAB_VALUES"),
  "tab deep-link validation missing",
);
const labsModuleSource = readSrc(
  "src", "components", "labs", "labs-module.tsx",
);
check(
  "labs module accepts an initial tab",
  labsModuleSource.includes("initialTab?: ModuleTab"),
  "initialTab prop missing",
);

/* ------------------------------------------------------------------ *
 * Dashboard row helpers (Phase 2 role dashboards)
 * ------------------------------------------------------------------ */

const {
  localDateString,
  pickUpcomingBookings,
  pickUpcomingCollections,
  sortQueueBySchedule,
  queueRowStatusBadge,
} = await import("@/lib/utils/dashboard-rows");

eq(
  "localDateString formats a local date as YYYY-MM-DD",
  localDateString(new Date(2026, 9, 26)),
  "2026-10-26",
);
eq(
  "localDateString pads single-digit month and day",
  localDateString(new Date(2026, 0, 5)),
  "2026-01-05",
);
{
  const now = new Date();
  const expected =
    `${now.getFullYear()}-` +
    `${String(now.getMonth() + 1).padStart(2, "0")}-` +
    `${String(now.getDate()).padStart(2, "0")}`;
  eq("localDateString defaults to today (browser-local)", localDateString(), expected);
  check(
    "localDateString always matches the YYYY-MM-DD shape",
    /^\d{4}-\d{2}-\d{2}$/.test(localDateString()),
    localDateString(),
  );
}

const upcomingInput = [
  { id: "past", bookingDate: "2026-10-20", timeSlot: "09:00" },
  { id: "today-late", bookingDate: "2026-10-26", timeSlot: "15:00" },
  { id: "today-early", bookingDate: "2026-10-26", timeSlot: "08:00" },
  { id: "future", bookingDate: "2026-11-02", timeSlot: "10:00" },
];
const upcomingSnapshot = JSON.stringify(upcomingInput);
const upcoming = pickUpcomingBookings(upcomingInput, "2026-10-26", 4);
eq(
  "pickUpcomingBookings drops past dates and orders today-first by slot",
  upcoming.map((row) => row.id),
  ["today-early", "today-late", "future"],
);
eq(
  "pickUpcomingBookings keeps the limit window",
  pickUpcomingBookings(upcomingInput, "2026-01-01", 2).map((row) => row.id),
  ["past", "today-early"],
);
check(
  "pickUpcomingBookings never mutates its input",
  JSON.stringify(upcomingInput) === upcomingSnapshot,
);
eq(
  "pickUpcomingBookings excludes everything before today",
  pickUpcomingBookings(upcomingInput, "2026-10-27").length,
  1,
);

const collectionInput = [
  { id: "yesterday", scheduledDate: "2026-10-25", timeSlot: "10:00" },
  { id: "today", scheduledDate: "2026-10-26", timeSlot: "11:00" },
  { id: "tomorrow", scheduledDate: "2026-10-27", timeSlot: "08:00" },
];
const collectionSnapshot = JSON.stringify(collectionInput);
const collections = pickUpcomingCollections(collectionInput, "2026-10-26", 2);
eq(
  "pickUpcomingCollections keeps today or later, soonest first",
  collections.map((row) => row.id),
  ["today", "tomorrow"],
);
check(
  "pickUpcomingCollections never mutates its input",
  JSON.stringify(collectionInput) === collectionSnapshot,
);

const queueInput = [
  { id: "q3", scheduledDate: "2026-10-26", timeSlot: "14:00" },
  { id: "q1", scheduledDate: "2026-10-26", timeSlot: "08:00" },
  { id: "q2", scheduledDate: "2026-10-26", timeSlot: "11:00" },
];
const queueSnapshot = JSON.stringify(queueInput);
eq(
  "sortQueueBySchedule orders slots ascending within the day",
  sortQueueBySchedule(queueInput).map((row) => row.id),
  ["q1", "q2", "q3"],
);
check(
  "sortQueueBySchedule never mutates its input",
  JSON.stringify(queueInput) === queueSnapshot,
);

eq(
  "queue badges: lab-visit PENDING uses the booking vocabulary",
  queueRowStatusBadge("LAB_VISIT", "PENDING"),
  { label: "Pending review", variant: "warning" },
);
eq(
  "queue badges: lab-visit CONFIRMED reads Confirmed",
  queueRowStatusBadge("LAB_VISIT", "CONFIRMED"),
  { label: "Confirmed", variant: "success" },
);
eq(
  "queue badges: home-collection CONFIRMED reads Accepted (own vocabulary)",
  queueRowStatusBadge("HOME_COLLECTION", "CONFIRMED"),
  { label: "Accepted", variant: "info" },
);
eq(
  "queue badges: home-collection ASSIGNED uses the primary variant",
  queueRowStatusBadge("HOME_COLLECTION", "ASSIGNED"),
  { label: "Collector assigned", variant: "primary" },
);
eq(
  "queue badges: unknown statuses fall back to neutral",
  queueRowStatusBadge("HOME_COLLECTION", "SOMETHING_NEW"),
  { label: "SOMETHING_NEW", variant: "neutral" },
);

/* ------------------------------------------------------------------ *
 * Infrastructure failures (503) vs authentication failures (401)
 * ------------------------------------------------------------------ */

const infraError = new InfrastructureError();
check("InfrastructureError extends AuthError", infraError instanceof AuthError);
check("InfrastructureError passes isAuthError", isAuthError(infraError));
eq("InfrastructureError status is 503", infraError.status, 503);
eq(
  "InfrastructureError message is the approved generic copy",
  infraError.message,
  "Service temporarily unavailable. Please try again.",
);
check("InfrastructureError is never reported as 401", infraError.status !== 401);
eq(
  "AuthError(401) contract preserved",
  new AuthError(401, "Authentication required.").status,
  401,
);
eq("AuthError(403) contract preserved", new AuthError(403, "Denied.").status, 403);
check("isAuthError rejects non-auth errors", !isAuthError(new Error("boom")));

const p2AuthSource = readSrc("src", "lib", "auth", "auth.ts");
check(
  "getCurrentUser throws InfrastructureError on DB failure",
  /getCurrentUser failed:[\s\S]{0,300}throw new InfrastructureError\(\)/.test(
    p2AuthSource,
  ),
);
check(
  "genuine auth failures still return null (-> 401)",
  p2AuthSource.includes("if (!user || !user.isActive) return null;"),
);
check(
  "authErrorResponse sets Retry-After on 503",
  p2AuthSource.includes('"Retry-After": "2"') &&
    p2AuthSource.includes("error.status === 503"),
);

const p2MeSource = readSrc("src", "app", "api", "auth", "me", "route.ts");
check(
  "auth/me serialises session-resolution failures via authErrorResponse (503)",
  p2MeSource.includes("authErrorResponse(error)"),
);
check("auth/me keeps its genuine 401 branch", p2MeSource.includes("Authentication required."));

const p2BoundarySource = readSrc("src", "app", "error.tsx");
check("root error boundary exists", p2BoundarySource.includes("export default function"));
check(
  "root error boundary offers a retry action",
  p2BoundarySource.includes("onRetry={reset}"),
);

const p2Step7LiveSource = readSrc("scripts", "step7", "live-contract-tests.mjs");
const p2ReviewLiveSource = readSrc("scripts", "step7", "review-workflow-live-tests.mjs");
for (const [suiteName, suiteSource] of [
  ["step7 live", p2Step7LiveSource],
  ["review live", p2ReviewLiveSource],
]) {
  check(
    `${suiteName} api() retries cookie-bearing 503s`,
    suiteSource.includes("response.status === 503"),
  );
  check(
    `${suiteName} page() retries cookie-bearing 500s`,
    suiteSource.includes("response.status === 500"),
  );
}

const p2ProxySource = readSrc("src", "proxy.ts");
check(
  "proxy stays cookie-only (no DB calls or auth-helper imports)",
  !/getCurrentUser|connectToDatabase|from ["']@\/lib\/auth/.test(p2ProxySource) &&
    p2ProxySource.includes("request.cookies.has"),
);

/* ------------------------------------------------------------------ *
 * Per-laboratory scoping model (P1)
 * ------------------------------------------------------------------ */

eq("scoped roles are exactly LAB_MANAGER + STAFF", [...SCOPED_ROLES], [
  "LAB_MANAGER",
  "STAFF",
]);

eq(
  "LAB_MANAGER with assignments is restricted",
  resolveLaboratoryScope({ role: "LAB_MANAGER", laboratoryIds: ["a", "b"] }),
  ["a", "b"],
);
eq(
  "STAFF with assignments is restricted",
  resolveLaboratoryScope({ role: "STAFF", laboratoryIds: ["x"] }),
  ["x"],
);
eq(
  "LAB_MANAGER without the field (legacy) is platform-wide",
  resolveLaboratoryScope({ role: "LAB_MANAGER" }),
  null,
);
eq(
  "STAFF without the field (legacy) is platform-wide",
  resolveLaboratoryScope({ role: "STAFF" }),
  null,
);
eq(
  "explicit [] stays scoped-to-nothing (not platform-wide)",
  resolveLaboratoryScope({ role: "LAB_MANAGER", laboratoryIds: [] }),
  [],
);
eq(
  "DOCTOR assignments never restrict",
  resolveLaboratoryScope({ role: "DOCTOR", laboratoryIds: ["a"] }),
  null,
);
eq(
  "ADMIN never restricted",
  resolveLaboratoryScope({ role: "ADMIN", laboratoryIds: ["a"] }),
  null,
);
eq(
  "SUPER_ADMIN never restricted",
  resolveLaboratoryScope({ role: "SUPER_ADMIN", laboratoryIds: ["a"] }),
  null,
);
eq(
  "PATIENT never restricted",
  resolveLaboratoryScope({ role: "PATIENT", laboratoryIds: ["a"] }),
  null,
);
eq(
  "COLLECTOR never restricted",
  resolveLaboratoryScope({ role: "COLLECTOR", laboratoryIds: ["a"] }),
  null,
);

check(
  "in-scope laboratory resolves true",
  isLaboratoryInScope({ role: "LAB_MANAGER", laboratoryIds: ["a", "b"] }, "b"),
);
check(
  "out-of-scope laboratory resolves false",
  !isLaboratoryInScope({ role: "LAB_MANAGER", laboratoryIds: ["a"] }, "c"),
);
check(
  "scoped-to-nothing account sees no laboratory",
  !isLaboratoryInScope({ role: "STAFF", laboratoryIds: [] }, "a"),
);
check(
  "legacy (absent field) account stays platform-wide",
  isLaboratoryInScope({ role: "LAB_MANAGER" }, "anything"),
);
check(
  "unscoped role sees every laboratory",
  isLaboratoryInScope({ role: "DOCTOR" }, "anything"),
);

eq(
  "scopeFilter is {} for unrestricted users",
  scopeFilter({ role: "ADMIN" }),
  {},
);
eq(
  "scopeFilter restricts laboratoryId for scoped users",
  scopeFilter({ role: "LAB_MANAGER", laboratoryIds: ["a", "b"] }),
  { laboratoryId: { $in: ["a", "b"] } },
);
eq(
  "scopeFilter for an empty scope matches nothing",
  scopeFilter({ role: "STAFF", laboratoryIds: [] }),
  { laboratoryId: { $in: [] } },
);
eq(
  "scopeFilter honours a custom field name",
  scopeFilter({ role: "STAFF", laboratoryIds: ["x"] }, "labId"),
  { labId: { $in: ["x"] } },
);

const p1UserModelSource = readSrc("src", "models", "User.ts");
check(
  "User model declares laboratoryIds",
  p1UserModelSource.includes("laboratoryIds?: string[];") &&
    p1UserModelSource.includes("type: [String]"),
);
check(
  "User model pins laboratoryIds to default: undefined (implicit [] would break legacy accounts)",
  /laboratoryIds:\s*\{\s*type:\s*\[String\],\s*default: undefined,/.test(
    // Strip line comments: the field's own doc-comment explains the rule.
    p1UserModelSource.replace(/\/\/[^\n]*/g, ""),
  ),
);
check(
  "User model registers a laboratoryIds multikey index",
  p1UserModelSource.includes("index({ laboratoryIds: 1 })"),
);

const p1AuthSource = readSrc("src", "lib", "auth", "auth.ts");
check(
  "toSafeUser forwards laboratoryIds only when it is a real array",
  p1AuthSource.includes("Array.isArray(user.laboratoryIds)") &&
    p1AuthSource.includes("{ laboratoryIds: [...user.laboratoryIds] }"),
);

const p1TypesSource = readSrc("src", "types", "auth.ts");
check(
  "SafeUser carries an optional laboratoryIds field",
  p1TypesSource.includes("laboratoryIds?: string[];"),
);

/* ------------------------------------------------------------------ *
 * P1 route enforcement coverage (scope folded into every operational
 * surface; booking/catalogue primitives deliberately stay unscoped)
 * ------------------------------------------------------------------ */

const p1ScopeSymbols = /scopeFilter|isLaboratoryInScope|resolveLaboratoryScope/;

const p1EnforcedRoutes = [
  "src/app/api/laboratories/route.ts",
  "src/app/api/laboratories/[id]/route.ts",
  "src/app/api/laboratories/[id]/status/route.ts",
  "src/app/api/laboratories/[id]/departments/route.ts",
  "src/app/api/lab-tests/route.ts",
  "src/app/api/lab-tests/[id]/route.ts",
  "src/app/api/lab-tests/[id]/status/route.ts",
  "src/app/api/lab-tests/[id]/parameters/route.ts",
  "src/app/api/lab-departments/[id]/route.ts",
  "src/app/api/lab-departments/[id]/status/route.ts",
  "src/app/api/lab-test-parameters/[id]/route.ts",
  "src/app/api/lab-bookings/route.ts",
  "src/app/api/lab-bookings/[id]/status/route.ts",
  "src/app/api/lab-bookings/[id]/reject/route.ts",
  "src/app/api/collection-requests/route.ts",
  "src/app/api/home-collections/route.ts",
  "src/app/api/home-collections/[id]/assign/route.ts",
  "src/app/api/home-collections/[id]/reject/route.ts",
  "src/app/api/home-collections/[id]/status/route.ts",
  "src/app/api/home-collections/[id]/verify-otp/route.ts",
];
for (const routePath of p1EnforcedRoutes) {
  const [api, ...rest] = routePath.split("/");
  const source = readSrc(api, ...rest);
  check(`P1 enforcement present in ${routePath}`, p1ScopeSymbols.test(source));
}

const p1BookingAuthSource = readSrc("src", "lib", "lab-booking", "authorization.ts");
check(
  "booking detail/cancel authorization enforces laboratory scope",
  p1BookingAuthSource.includes("bookingInScope") &&
    p1BookingAuthSource.includes('from "@/lib/auth/laboratory-scope"'),
);
const p1CollectionAuthSource = readSrc(
  "src",
  "lib",
  "home-collection",
  "authorization.ts",
);
check(
  "collection detail/cancel authorization enforces laboratory scope",
  p1CollectionAuthSource.includes("collectionInScope") &&
    p1CollectionAuthSource.includes('from "@/lib/auth/laboratory-scope"'),
);

check(
  "laboratory creation is SUPER_ADMIN/ADMIN only (F1)",
  /POST[\s\S]*requireRole\(ROLES\.SUPER_ADMIN, ROLES\.ADMIN\)/.test(
    readSrc("src", "app", "api", "laboratories", "route.ts"),
  ),
);

// Patient/booking primitives must stay UNscoped (F2/F3): no scope symbols.
const p1UnscopedRoutes = [
  "src/app/api/lab-bookings/catalog/route.ts",
  "src/app/api/lab-bookings/catalog/tests/route.ts",
  "src/app/api/lab-bookings/availability/route.ts",
  "src/app/api/home-collections/catalog/route.ts",
  "src/app/api/home-collections/availability/route.ts",
  "src/app/api/home-collections/eligible-bookings/route.ts",
  "src/app/api/home-collections/collectors/route.ts",
];
for (const routePath of p1UnscopedRoutes) {
  const [api, ...rest] = routePath.split("/");
  const source = readSrc(api, ...rest);
  check(
    `P1 scoping NOT applied to primitive ${routePath}`,
    !p1ScopeSymbols.test(source),
  );
}

const p1SeedSource = readSrc("scripts", "seed-dev-user.mjs");
check(
  "seed gives new LM/STAFF accounts an explicit empty laboratoryIds (insert-only)",
  p1SeedSource.includes("$setOnInsert") &&
    p1SeedSource.includes("laboratoryIds: []"),
);

/* ------------------------------------------------------------------ *
 * P1 assignment API + admin UI (step 3: scope can actually be set)
 * ------------------------------------------------------------------ */

const p1UsersRoute = readSrc("src", "app", "api", "users", "route.ts");
check(
  "user directory GET is SUPER_ADMIN/ADMIN only",
  /requireRole\(ROLES\.SUPER_ADMIN, ROLES\.ADMIN\)/.test(p1UsersRoute),
);
check(
  "user directory rows go through the credential-free toSafeUser projection",
  p1UsersRoute.includes("toSafeUser"),
);
check(
  "user directory supports role + search + pagination filtering",
  p1UsersRoute.includes("userListQuerySchema") &&
    p1UsersRoute.includes("containsRegex"),
);

const p1ScopeRoute = readSrc(
  "src",
  "app",
  "api",
  "users",
  "[id]",
  "laboratory-scope",
  "route.ts",
);
check(
  "laboratory-scope PATCH is SUPER_ADMIN/ADMIN only",
  /requireRole\(ROLES\.SUPER_ADMIN, ROLES\.ADMIN\)/.test(p1ScopeRoute),
);
check(
  "laboratory-scope PATCH only accepts LAB_MANAGER/STAFF targets",
  p1ScopeRoute.includes("SCOPED_ROLES") &&
    p1ScopeRoute.includes("Laboratory scope only applies to lab manager and staff accounts."),
);
check(
  "laboratory-scope PATCH records bounded history on change",
  p1ScopeRoute.includes("$push") &&
    p1ScopeRoute.includes("laboratoryScopeHistory") &&
    p1ScopeRoute.includes("$slice: -SCOPE_HISTORY_CAP"),
);
check(
  "laboratory-scope PATCH stores the previous assignment",
  p1ScopeRoute.includes("previousLaboratoryIds"),
);
check(
  "laboratory-scope PATCH skips the audit entry for an unchanged set",
  p1ScopeRoute.includes("sameIdSet") &&
    p1ScopeRoute.includes("return itemResponse(toSafeUser(user));"),
);
check(
  "laboratory-scope PATCH rejects ids of deleted laboratories",
  p1ScopeRoute.includes("Laboratory.countDocuments") &&
    p1ScopeRoute.includes("no longer exist"),
);

const p1UserScopeValidation = readSrc("src", "lib", "validation", "user-scope.ts");
check(
  "scope update schema rejects duplicate laboratories",
  p1UserScopeValidation.includes("userScopeUpdateSchema") &&
    p1UserScopeValidation.includes("new Set(ids).size"),
);
check(
  "scope history cap is defined next to the schema",
  p1UserScopeValidation.includes("SCOPE_HISTORY_CAP = 50"),
);

const p1ScopeHistoryModelSource = readSrc("src", "models", "User.ts");
check(
  "user schema embeds the laboratoryScopeHistory audit trail",
  p1ScopeHistoryModelSource.includes("laboratoryScopeHistory:") &&
    p1ScopeHistoryModelSource.includes("previousLaboratoryIds: { type: [String], required: true }") &&
    p1ScopeHistoryModelSource.includes("changedBy: { type: String, required: true }") &&
    p1ScopeHistoryModelSource.includes("changedAt: { type: Date, required: true }"),
);

const p1AdminUsersPage = readSrc(
  "src",
  "app",
  "(dashboard)",
  "admin",
  "users",
  "page.tsx",
);
check(
  "admin assignment page is gated to SUPER_ADMIN/ADMIN",
  p1AdminUsersPage.includes("ROLES.SUPER_ADMIN") &&
    p1AdminUsersPage.includes("ROLES.ADMIN") &&
    p1AdminUsersPage.includes("ASSIGNMENT_ROLES.includes(user.role)"),
);
check(
  "admin assignment page redirects unauthenticated visitors to login",
  p1AdminUsersPage.includes("if (!user) redirect(LOGIN_ROUTE);"),
);

const p1AssignmentComponent = readSrc(
  "src",
  "components",
  "admin",
  "user-laboratory-assignment.tsx",
);
check(
  "assignment editor is a client component posting the PATCH endpoint",
  p1AssignmentComponent.startsWith('"use client"') &&
    p1AssignmentComponent.includes("}/laboratory-scope"),
);
check(
  "assignment editor only saves when the selection actually changed",
  p1AssignmentComponent.includes("disabled={!dirty || saving}"),
);
check(
  "assignment editor labels untouched legacy accounts as platform-wide",
  p1AssignmentComponent.includes("Platform-wide (legacy)"),
);

const p1NavigationSource = readSrc("src", "config", "navigation.ts");
check(
  "sidebar exposes the /admin/users entry",
  p1NavigationSource.includes('href: "/admin/users"') &&
    p1NavigationSource.includes('label: "Staff Access"'),
);

/* ------------------------------------------------------------------ *
 * Staff account provisioning (P0-a)
 * ------------------------------------------------------------------ */

eq("PROVISIONABLE_ROLES is exactly ADMIN/DOCTOR/LM/STAFF/COLLECTOR", [
  ...PROVISIONABLE_ROLES,
], ["ADMIN", "DOCTOR", "LAB_MANAGER", "STAFF", "COLLECTOR"]);
check(
  "SUPER_ADMIN is never provisionable through the API",
  !PROVISIONABLE_ROLES.includes(ROLES.SUPER_ADMIN),
);
check(
  "PATIENT self-registers and is never provisionable",
  !PROVISIONABLE_ROLES.includes(ROLES.PATIENT),
);

const validCreate = {
  name: "Lab Lead",
  email: "lead@example.com",
  phone: "+91 98765 43210",
  password: "strong-passphrase-1",
  confirmPassword: "strong-passphrase-1",
  role: "LAB_MANAGER",
};
const createParsed = userCreateSchema.safeParse(validCreate);
check("valid staff-provisioning payload passes", createParsed.success);
eq(
  "create schema normalises email to lowercase",
  createParsed.success ? createParsed.data.email : null,
  "lead@example.com",
);
check(
  "create schema rejects SUPER_ADMIN",
  !userCreateSchema.safeParse({ ...validCreate, role: "SUPER_ADMIN" }).success,
);
check(
  "create schema rejects PATIENT",
  !userCreateSchema.safeParse({ ...validCreate, role: "PATIENT" }).success,
);
check(
  "create schema enforces the 8-character password floor",
  !userCreateSchema.safeParse({
    ...validCreate,
    password: "short",
    confirmPassword: "short",
  }).success,
);
check(
  "create schema rejects mismatched confirmPassword",
  !userCreateSchema.safeParse({
    ...validCreate,
    confirmPassword: "different-pass",
  }).success,
);

check(
  "patch schema rejects an empty body",
  !userPatchSchema.safeParse({}).success,
);
check(
  "patch schema accepts a name-only update",
  userPatchSchema.safeParse({ name: "Renamed Person" }).success,
);
check(
  "patch schema accepts deactivation",
  userPatchSchema.safeParse({ isActive: false }).success,
);
check(
  "patch schema cannot grant SUPER_ADMIN",
  !userPatchSchema.safeParse({ role: "SUPER_ADMIN" }).success,
);

const p0aPostRoute = readSrc("src", "app", "api", "users", "route.ts");
check(
  "POST /api/users is SUPER_ADMIN/ADMIN only",
  /POST[\s\S]*requireRole\(ROLES\.SUPER_ADMIN, ROLES\.ADMIN\)/.test(p0aPostRoute),
);
check(
  "POST /api/users hashes the password before storage",
  p0aPostRoute.includes("hashPassword"),
);
check(
  "POST /api/users never stores a plain password field",
  !p0aPostRoute.includes("password:"),
);
check(
  "new LAB_MANAGER/STAFF accounts start explicitly scoped to nothing",
  p0aPostRoute.includes("laboratoryIds: []") &&
    p0aPostRoute.includes("SCOPED_ROLES"),
);
check(
  "POST /api/users rejects duplicate emails with 409",
  p0aPostRoute.includes("An account with this email already exists."),
);
check(
  "POST /api/users returns the credential-free SafeUser shape",
  p0aPostRoute.includes("toSafeUser") && p0aPostRoute.includes("201"),
);

const p0aPatchRoute = readSrc("src", "app", "api", "users", "[id]", "route.ts");
check(
  "PATCH /api/users/[id] is SUPER_ADMIN/ADMIN only",
  /requireRole\(ROLES\.SUPER_ADMIN, ROLES\.ADMIN\)/.test(p0aPatchRoute),
);
check(
  "PATCH rejects self-mutation (no self-disable/demote)",
  p0aPatchRoute.includes("You cannot edit your own account here."),
);
check(
  "SUPER_ADMIN targets are only editable by a SUPER_ADMIN actor",
  p0aPatchRoute.includes("Only a super admin can modify super admin accounts."),
);
check(
  "PATCH validates through userPatchSchema",
  p0aPatchRoute.includes("userPatchSchema"),
);
check(
  "PATCH fail-closes a promotion into a scoped role",
  p0aPatchRoute.includes("laboratoryIds = []"),
);
check(
  "PATCH uniqueness-checks an email change",
  p0aPatchRoute.includes("An account with this email already exists."),
);

const p0aRegisterSource = readSrc("src", "app", "api", "auth", "register", "route.ts");
check(
  "register docblock points at the real provisioning endpoint",
  p0aRegisterSource.includes("POST /api/users"),
);

const p0aStaffPage = readSrc("src", "app", "(dashboard)", "staff", "page.tsx");
check(
  "staff page is gated to SUPER_ADMIN/ADMIN",
  p0aStaffPage.includes("ROLES.SUPER_ADMIN") &&
    p0aStaffPage.includes("ROLES.ADMIN") &&
    p0aStaffPage.includes("STAFF_MANAGEMENT_ROLES.includes(user.role)"),
);
check(
  "staff page redirects unauthenticated visitors to login",
  p0aStaffPage.includes("if (!user) redirect(LOGIN_ROUTE);"),
);
check(
  "staff page renders the real accounts surface, not the placeholder",
  p0aStaffPage.includes("StaffAccounts") &&
    !p0aStaffPage.includes("ModulePlaceholder"),
);

const p0aAccountsComponent = readSrc(
  "src",
  "components",
  "staff",
  "staff-accounts.tsx",
);
check(
  "staff accounts list is a client component backed by GET /api/users",
  p0aAccountsComponent.startsWith('"use client"') &&
    p0aAccountsComponent.includes("/api/users?"),
);
check(
  "staff accounts list is paginated",
  p0aAccountsComponent.includes("Pagination"),
);

const p0aFormModal = readSrc(
  "src",
  "components",
  "staff",
  "staff-form-modal.tsx",
);
check(
  "staff form modal posts POST /api/users and patches PATCH /api/users/[id]",
  p0aFormModal.includes("/api/users/${user!.id}") &&
    p0aFormModal.includes('"/api/users"'),
);
check(
  "staff form modal validates with the shared Zod schemas",
  p0aFormModal.includes("userCreateSchema") &&
    p0aFormModal.includes("userPatchSchema"),
);

/* ------------------------------------------------------------------ *
 * Doctor / Clinic module (P0-c): schemas, roles, model contracts
 * ------------------------------------------------------------------ */

const validP0CClinic = {
  name: "Sunrise Clinic",
  code: "CLINIC-P0C",
  city: "Pune",
  state: "Maharashtra",
};
check("valid clinic payload passes", clinicCreateSchema.safeParse(validP0CClinic).success);
check(
  "clinic create rejects a too-short name",
  !clinicCreateSchema.safeParse({ ...validP0CClinic, name: "A" }).success,
);
check(
  "clinic update accepts a partial payload",
  clinicUpdateSchema.safeParse({ city: "Mumbai" }).success,
);
check(
  "clinic status requires a boolean",
  clinicStatusSchema.safeParse({ isActive: true }).success &&
    !clinicStatusSchema.safeParse({ isActive: "yes" }).success,
);

const validP0CDoctor = {
  name: "Dr House",
  email: "house@clinic.com",
  specialization: "Internal Medicine",
  clinicId: "507f1f77bcf86cd799439011",
  doctorCode: "DOC-P0C",
};
check("valid doctor payload passes", doctorCreateSchema.safeParse(validP0CDoctor).success);
check(
  "doctor create requires a clinic assignment",
  !doctorCreateSchema.safeParse({
    ...validP0CDoctor,
    clinicId: undefined,
  }).success,
);
check(
  "doctor create rejects a malformed doctor code",
  !doctorCreateSchema.safeParse({ ...validP0CDoctor, doctorCode: "!!" }).success,
);
check(
  "doctor update accepts a partial payload",
  doctorUpdateSchema.safeParse({ specialization: "Cardiology" }).success,
);
check(
  "doctor status requires a boolean",
  doctorStatusSchema.safeParse({ isActive: false }).success &&
    !doctorStatusSchema.safeParse({}).success,
);

const doctorCollectionRoute = readSrc("src", "app", "api", "doctors", "route.ts");
check(
  "doctor directory GET allows SA/ADMIN/DOCTOR (doctor self-scoped)",
  /requireRole\(\s*ROLES\.SUPER_ADMIN,\s*ROLES\.ADMIN,\s*ROLES\.DOCTOR,?\s*\)/.test(
    doctorCollectionRoute,
  ) && doctorCollectionRoute.includes("filter.userId = user.id;"),
);
check(
  "doctor creation is SUPER_ADMIN/ADMIN only",
  /POST[\s\S]*requireRole\(ROLES\.SUPER_ADMIN, ROLES\.ADMIN\)/.test(
    doctorCollectionRoute,
  ),
);
check(
  "doctor create refuses inactive clinics",
  doctorCollectionRoute.includes("The selected clinic is inactive."),
);
check(
  "doctor create refuses unknown clinics with 404",
  doctorCollectionRoute.includes("The selected clinic was not found."),
);

const doctorDetailRoute = readSrc("src", "app", "api", "doctors", "[id]", "route.ts");
check(
  "doctor detail GET hides foreign profiles from DOCTOR with 404",
  doctorDetailRoute.includes("Doctor not found.") &&
    doctorDetailRoute.includes("owner !== user.id"),
);
check(
  "doctor PATCH is SUPER_ADMIN/ADMIN only",
  /requireRole\(ROLES\.SUPER_ADMIN, ROLES\.ADMIN\)/.test(doctorDetailRoute),
);
check(
  "doctor PATCH rejects an empty update",
  doctorDetailRoute.includes("No changes were provided."),
);

const doctorModelSource = readSrc("src", "models", "Doctor.ts");
check(
  "doctorCode is unique",
  /doctorCode:[\s\S]{0,200}unique: true/.test(doctorModelSource),
);
check(
  "doctor model links a userId for account association",
  doctorModelSource.includes("userId"),
);

const clinicCollectionRoute = readSrc("src", "app", "api", "clinics", "route.ts");
check(
  "clinic directory is SUPER_ADMIN/ADMIN only",
  /requireRole\(ROLES\.SUPER_ADMIN, ROLES\.ADMIN\)/.test(clinicCollectionRoute),
);
check(
  "clinic creation is SUPER_ADMIN/ADMIN only",
  /POST[\s\S]*requireRole\(ROLES\.SUPER_ADMIN, ROLES\.ADMIN\)/.test(
    clinicCollectionRoute,
  ),
);
check(
  "clinic create rejects duplicate codes with 409",
  clinicCollectionRoute.includes("A clinic with this code already exists."),
);

const clinicModelSource = readSrc("src", "models", "Clinic.ts");
check(
  "clinic code is unique",
  /code:[\s\S]{0,200}unique: true/.test(clinicModelSource),
);

/* ------------------------------------------------------------------ *
 * Lab / LIMS module (P0-c): parameter contracts + delete semantics
 * ------------------------------------------------------------------ */

const validParameter = {
  labTestId: "507f1f77bcf86cd799439011",
  name: "Hemoglobin",
  code: "HGB",
  dataType: "NUMBER",
};
check(
  "valid parameter payload passes",
  parameterCreateSchema.safeParse(validParameter).success,
);
check(
  "parameter create requires the parent test id",
  !parameterCreateSchema.safeParse({ ...validParameter, labTestId: undefined })
    .success,
);
check(
  "parameter create rejects an unknown data type",
  !parameterCreateSchema.safeParse({ ...validParameter, dataType: "PIXEL" })
    .success,
);
check(
  "parameter create rejects a malformed code",
  !parameterCreateSchema.safeParse({ ...validParameter, code: "!!" }).success,
);

const parameterRouteSource = readSrc(
  "src",
  "app",
  "api",
  "lab-test-parameters",
  "[id]",
  "route.ts",
);
check(
  "parameter DELETE is the only hard-delete in the API surface",
  parameterRouteSource.includes("findByIdAndDelete"),
);
check(
  "parameter DELETE renumbers the remaining list (displayOrder stays 1..n)",
  parameterRouteSource.includes("displayOrder: index + 1") &&
    parameterRouteSource.includes("bulkWrite"),
);
check(
  "parameter DELETE enforces the parent test's laboratory scope",
  parameterRouteSource.includes("parentTestInScope"),
);

const labStatusRoutes = [
  ["src/app/api/laboratories/[id]/status/route.ts", "laboratory"],
  ["src/app/api/lab-departments/[id]/status/route.ts", "department"],
  ["src/app/api/lab-tests/[id]/status/route.ts", "test"],
];
for (const [routePath, label] of labStatusRoutes) {
  const [api, ...rest] = routePath.split("/");
  const source = readSrc(api, ...rest);
  check(
    `${label} status route exists and toggles isActive`,
    source.includes("$set") && source.includes("isActive"),
  );
}

const labTestModelSource = readSrc("src", "models", "LabTest.ts");
check(
  "lab test code is unique within its laboratory",
  labTestModelSource.includes(
    "index({ laboratoryId: 1, code: 1 }, { unique: true })",
  ),
);
const labDeptModelSource = readSrc("src", "models", "LabDepartment.ts");
check(
  "department code is unique within its laboratory",
  labDeptModelSource.includes(
    "index({ laboratoryId: 1, code: 1 }, { unique: true })",
  ),
);
const labParamModelSource = readSrc("src", "models", "LabTestParameter.ts");
check(
  "parameter code is unique within its lab test",
  labParamModelSource.includes(
    "index({ labTestId: 1, code: 1 }, { unique: true })",
  ),
);


/* ------------------------------------------------------------------ *
 * P1-1 Patient Management (offline contracts)
 * ------------------------------------------------------------------ */

// ---- config + model ----
check(
  "patient genders match the shared three-value vocabulary",
  PATIENT_GENDERS.length === 3 &&
    PATIENT_GENDERS.includes("MALE") &&
    PATIENT_GENDERS.includes("FEMALE") &&
    PATIENT_GENDERS.includes("OTHER"),
);
check(
  "patient blood groups cover the eight standard codes",
  PATIENT_BLOOD_GROUPS.length === 8 &&
    PATIENT_BLOOD_GROUPS.includes("A_POS") &&
    PATIENT_BLOOD_GROUPS.includes("O_NEG"),
);
check(
  "notes cap is the configured maximum",
  PATIENT_NOTES_MAX_LENGTH === 1000,
);

const patientModelSource = readSrc("src", "models", "PatientProfile.ts");
check(
  "profile userId is a unique User reference",
  /userId:[\s\S]{0,120}ref: "User"[\s\S]{0,80}unique: true/.test(
    patientModelSource,
  ) ||
    (/userId:[\s\S]{0,200}unique: true/.test(patientModelSource) &&
      patientModelSource.includes('ref: "User"')),
);
check(
  "profile never stores the account email (identity stays on User)",
  !patientModelSource.includes("email:") && !patientModelSource.includes("email: {"),
);
check(
  "profile keeps staff-only notes with the configured cap",
  patientModelSource.includes("PATIENT_NOTES_MAX_LENGTH"),
);
check(
  "profile record switch defaults to active",
  /isActive:[\s\S]{0,80}default: true/.test(patientModelSource),
);
check(
  "profile index covers the record-status filter",
  patientModelSource.includes("index({ isActive: 1 })"),
);

// ---- validation schemas ----
const validPatientCreate = {
  name: "Asha Rao",
  email: "asha@example.com",
  phone: "+91 98765 43210",
};
check(
  "valid patient create payload passes without a password",
  patientCreateSchema.safeParse(validPatientCreate).success,
);
check(
  "patient create rejects a too-short name",
  !patientCreateSchema.safeParse({ ...validPatientCreate, name: "A" }).success,
);
check(
  "patient create rejects an invalid email",
  !patientCreateSchema.safeParse({ ...validPatientCreate, email: "nope" })
    .success,
);
check(
  "patient create rejects a short provided password",
  !patientCreateSchema.safeParse({ ...validPatientCreate, password: "short" })
    .success,
);
check(
  "patient create accepts a strong provided password",
  patientCreateSchema.safeParse({
    ...validPatientCreate,
    password: "Str0ngPass!",
  }).success,
);
check(
  "address is all-or-nothing (line1 alone fails)",
  !patientCreateSchema.safeParse({
    ...validPatientCreate,
    profile: { address: { line1: "12 MG Road" } },
  }).success,
);
check(
  "complete address passes",
  patientCreateSchema.safeParse({
    ...validPatientCreate,
    profile: {
      address: {
        line1: "12 MG Road",
        line2: null,
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
      },
    },
  }).success,
);
check(
  "emergency contact is all-or-nothing (name without phone fails)",
  !patientCreateSchema.safeParse({
    ...validPatientCreate,
    profile: { emergencyContact: { name: "Ravi Rao" } },
  }).success,
);
check(
  "complete emergency contact passes",
  patientCreateSchema.safeParse({
    ...validPatientCreate,
    profile: {
      emergencyContact: {
        name: "Ravi Rao",
        phone: "+91 91234 56780",
        relationship: "Spouse",
      },
    },
  }).success,
);
check(
  "invalid blood group is rejected",
  !patientCreateSchema.safeParse({
    ...validPatientCreate,
    profile: { bloodGroup: "Z+" },
  }).success,
);
check(
  "invalid gender is rejected",
  !patientCreateSchema.safeParse({
    ...validPatientCreate,
    profile: { gender: "ROBOT" },
  }).success,
);
check(
  "date string accepts a real calendar date",
  patientDateStringSchema.safeParse("2000-02-29").success,
);
check(
  "date string rejects an impossible calendar date",
  !patientDateStringSchema.safeParse("2001-02-29").success,
);
check(
  "staff patch accepts an isActive-only update",
  patientPatchSchema.safeParse({ isActive: false }).success,
);
check(
  "staff patch accepts demographics plus notes",
  patientPatchSchema.safeParse({ gender: "FEMALE", notes: "Allergic to X." })
    .success,
);
check(
  "staff patch rejects an empty body",
  !patientPatchSchema.safeParse({}).success,
);
check(
  "self-put accepts demographics",
  patientSelfPutSchema.safeParse({ bloodGroup: "O_POS" }).success,
);
check(
  "self-put cannot smuggle staff-only notes as its only field",
  !patientSelfPutSchema.safeParse({ notes: "secret" }).success,
);
check(
  "self-put cannot smuggle the record-status switch as its only field",
  !patientSelfPutSchema.safeParse({ isActive: false }).success,
);
check(
  "self-put rejects an empty body",
  !patientSelfPutSchema.safeParse({}).success,
);
check(
  "status toggle requires a boolean",
  patientStatusSchema.safeParse({ isActive: false }).success &&
    !patientStatusSchema.safeParse({ isActive: "no" }).success,
);
check(
  "list query accepts the record-status filter",
  patientListQuerySchema.safeParse({ status: "inactive" }).success &&
    !patientListQuerySchema.safeParse({ status: "archived" }).success,
);

// ---- directory + create route ----
const patientsRouteSource = readSrc("src", "app", "api", "patients", "route.ts");
check(
  "patient directory allows LAB_MANAGER/STAFF plus ADMIN/SA",
  patientsRouteSource.includes("ROLES.LAB_MANAGER") &&
    patientsRouteSource.includes("ROLES.STAFF") &&
    patientsRouteSource.includes("ROLES.ADMIN") &&
    patientsRouteSource.includes("ROLES.SUPER_ADMIN"),
);
check(
  "directory rows are PATIENT-role users only",
  patientsRouteSource.includes("role: ROLES.PATIENT"),
);
check(
  "staff create is ADMIN/SA only",
  /requireRole\(ROLES\.SUPER_ADMIN, ROLES\.ADMIN\)/.test(patientsRouteSource),
);
check(
  "create issues no session (no cookie/session write in the route)",
  !patientsRouteSource.includes("cookies()"),
);
check(
  "generated temporary password is returned exactly once via the response body",
  patientsRouteSource.includes("temporaryPassword: generatedPassword"),
);
check(
  "create compensates a failed profile insert by deleting the new user",
  patientsRouteSource.includes("User.deleteOne") &&
    patientsRouteSource.includes("Compensating cleanup"),
);
check(
  "the create route never logs request payloads",
  !patientsRouteSource.includes("console."),
);

// ---- detail + status + self routes ----
const patientDetailSource = readSrc(
  "src",
  "app",
  "api",
  "patients",
  "[id]",
  "route.ts",
);
check(
  "patient detail GET allows LM/STAFF/ADMIN/SA",
  patientDetailSource.includes("READ_ROLES") &&
    patientDetailSource.includes("ROLES.LAB_MANAGER") &&
    patientDetailSource.includes("ROLES.STAFF"),
);
check(
  "detail GET hides non-patient accounts behind 404",
  patientDetailSource.includes("Patient not found.") &&
    patientDetailSource.includes('role: ROLES.PATIENT'),
);
check(
  "staff-side demographics edit is ADMIN/SA only",
  patientDetailSource.includes("EDIT_ROLES") &&
    /EDIT_ROLES = \[ROLES\.SUPER_ADMIN, ROLES\.ADMIN\]/.test(patientDetailSource),
);
check(
  "detail PATCH upserts so legacy accounts gain a profile",
  patientDetailSource.includes("upsert: true"),
);

const patientStatusSource = readSrc(
  "src",
  "app",
  "api",
  "patients",
  "[id]",
  "status",
  "route.ts",
);
check(
  "record-status toggle is ADMIN/SA only",
  /requireRole\(ROLES\.SUPER_ADMIN, ROLES\.ADMIN\)/.test(patientStatusSource),
);
check(
  "record-status toggle upserts (deactivating a profile-less account creates the row)",
  patientStatusSource.includes("upsert: true"),
);

const patientMeSource = readSrc("src", "app", "api", "patients", "me", "route.ts");
check(
  "self view requires the PATIENT role",
  /requireRole\(ROLES\.PATIENT\)/.test(patientMeSource),
);
const meGetPath = patientMeSource.slice(
  patientMeSource.indexOf("export async function GET"),
  patientMeSource.lastIndexOf("PUT /api/patients/me"),
);
check(
  "self view never writes on read (no upsert in the GET path)",
  meGetPath.length > 0 &&
    !meGetPath.includes("upsert") &&
    !meGetPath.includes("findOneAndUpdate"),
);
check(
  "self PUT cannot set staff-only notes",
  !patientMeSource.includes("notes:") && !patientMeSource.includes("$set.notes"),
);
const selfSetBuilder = patientMeSource.slice(
  patientMeSource.indexOf("function buildSelf$set"),
  patientMeSource.indexOf("export async function GET"),
);
check(
  "self PUT cannot set the record-status switch",
  selfSetBuilder.length > 0 && !selfSetBuilder.includes("isActive"),
);
check(
  "self PUT upserts the profile row",
  patientMeSource.includes("upsert: true"),
);

// ---- DTOs + temp password ----
const patientDtoSource = readSrc("src", "lib", "patient", "dto.ts");
check(
  "self DTO rebuilds the profile without the notes key",
  patientDtoSource.includes("toPatientProfileDto(profile, false)"),
);
check(
  "staff DTO includes notes",
  patientDtoSource.includes("includeNotes: boolean") ||
    patientDtoSource.includes("toPatientProfileDto(profile, true)"),
);

const tempPasswordSource = readSrc("src", "lib", "patient", "temp-password.ts");
check(
  "temporary passwords are crypto-random (no Math.random)",
  tempPasswordSource.includes("node:crypto") &&
    tempPasswordSource.includes("randomInt") &&
    !tempPasswordSource.includes("Math.random"),
);

// ---- deactivated-record guards on booking + collection creation ----
const bookingCreateSource = readSrc("src", "app", "api", "lab-bookings", "route.ts");
check(
  "booking creation blocks deactivated patient records",
  bookingCreateSource.includes("deactivated patient-record guard") &&
    bookingCreateSource.includes("patientProfile.isActive === false"),
);
const collectionCreateSource = readSrc(
  "src",
  "app",
  "api",
  "home-collections",
  "route.ts",
);
check(
  "collection creation blocks deactivated patient records",
  collectionCreateSource.includes("deactivated patient-record guard") &&
    collectionCreateSource.includes("patientProfile.isActive === false"),
);

// ---- pages ----
const patientsPageSource = readSrc(
  "src",
  "app",
  "(dashboard)",
  "patients",
  "page.tsx",
);
check(
  "/patients gates to the directory roles",
  patientsPageSource.includes("ROLES.LAB_MANAGER") &&
    patientsPageSource.includes("ROLES.STAFF") &&
    patientsPageSource.includes("ROLES.ADMIN") &&
    patientsPageSource.includes("ROLES.SUPER_ADMIN"),
);
check(
  "/patients passes the manage flag from the session role",
  patientsPageSource.includes("canManage="),
);

const patientSelfProfilePageSource = readSrc(
  "src",
  "app",
  "(dashboard)",
  "profile",
  "page.tsx",
);
check(
  "/profile renders the self editor only for PATIENT",
  patientSelfProfilePageSource.includes("PatientSelfEditor") &&
    patientSelfProfilePageSource.includes("ROLES.PATIENT"),
);

/* ------------------------------------------------------------------ *
 * P1-2 Billing & Payment contracts
 * ------------------------------------------------------------------ */

// ---- configuration & lifecycle ----
eq(
  "INVOICE_STATUSES is DRAFT/ISSUED/PAID/VOID",
  [...INVOICE_STATUSES],
  ["DRAFT", "ISSUED", "PAID", "VOID"],
);
eq("DRAFT can issue or void", INVOICE_TRANSITIONS.DRAFT, ["ISSUED", "VOID"]);
eq("ISSUED can only void", INVOICE_TRANSITIONS.ISSUED, ["VOID"]);
eq("PAID has no client transition", INVOICE_TRANSITIONS.PAID, []);
eq("VOID is terminal", INVOICE_TRANSITIONS.VOID, []);
eq("formatInvoiceCode zero-pads", formatInvoiceCode(2026, 7), "INV-2026-000007");
check(
  "invoice code pattern accepts generated codes",
  INVOICE_CODE_PATTERN.test(formatInvoiceCode(2026, 7)),
);
check(
  "invoice code pattern rejects junk and foreign codes",
  !INVOICE_CODE_PATTERN.test("INV-2026-7") &&
    !INVOICE_CODE_PATTERN.test("LAB-2026-000001"),
);
eq(
  "formatPaymentCode zero-pads",
  formatPaymentCode(2026, 12),
  "PAY-2026-000012",
);
check(
  "payment code pattern accepts generated codes",
  PAYMENT_CODE_PATTERN.test(formatPaymentCode(2026, 12)),
);
check(
  "invoiceable booking statuses cover completed + cancelled history",
  INVOICEABLE_BOOKING_STATUSES.includes("COMPLETED") &&
    INVOICEABLE_BOOKING_STATUSES.includes("CANCELLED") &&
    !INVOICEABLE_BOOKING_STATUSES.includes("PENDING") &&
    !INVOICEABLE_BOOKING_STATUSES.includes("REJECTED"),
);
check(
  "invoiceable collection statuses include collected + cancelled but not FAILED",
  INVOICEABLE_COLLECTION_STATUSES.includes("COLLECTED") &&
    INVOICEABLE_COLLECTION_STATUSES.includes("CANCELLED") &&
    !INVOICEABLE_COLLECTION_STATUSES.includes("FAILED") &&
    !INVOICEABLE_COLLECTION_STATUSES.includes("PENDING"),
);
eq("PAYMENT_KINDS is PAYMENT/REFUND", [...PAYMENT_KINDS], ["PAYMENT", "REFUND"]);

// ---- money rounding ----
eq("money rounds 10.005 half-up", money(10.005), 10.01);
eq("money repairs 0.1 + 0.2", money(0.1 + 0.2), 0.3);
check("moneyEquals tolerates float noise", moneyEquals(0.30000000000000004, 0.3));

// ---- derived balance arithmetic ----
eq(
  "netPaid sums payments minus refunds",
  netPaid([
    { kind: "PAYMENT", amount: 100 },
    { kind: "REFUND", amount: 30 },
  ]),
  70,
);
eq(
  "balance after full payment is zero",
  outstandingBalance(100, [{ kind: "PAYMENT", amount: 100 }]),
  0,
);
eq("balance before payments equals total", outstandingBalance(100, []), 100);
eq(
  "balance never goes negative on overshoot",
  outstandingBalance(100, [{ kind: "PAYMENT", amount: 150 }]),
  0,
);
check(
  "isFullySettled at exact total",
  isFullySettled(100, [{ kind: "PAYMENT", amount: 100 }]),
);
check(
  "isFullySettled false for partial payment",
  !isFullySettled(100, [{ kind: "PAYMENT", amount: 40 }]),
);
check(
  "isFullyRefunded after money returned",
  isFullyRefunded(100, [
    { kind: "PAYMENT", amount: 100 },
    { kind: "REFUND", amount: 100 },
  ]),
);
check("isFullyRefunded false for zero-total", !isFullyRefunded(0, []));

// ---- create schema ----
const blCreateBooking = invoiceCreateSchema.safeParse({
  sourceType: "BOOKING",
  sourceId: "64b000000000000000000001",
});
check("BOOKING create payload passes", blCreateBooking.success);
const blManualBase = {
  sourceType: "MANUAL",
  patientId: "64b000000000000000000002",
  laboratoryId: "64b000000000000000000003",
};
const blCreateManual = invoiceCreateSchema.safeParse({
  ...blManualBase,
  items: [{ description: "Consult", unitPrice: 250.5, quantity: 2 }],
});
check("MANUAL create payload passes", blCreateManual.success);
check(
  "MANUAL rejects an empty item list",
  !invoiceCreateSchema.safeParse({ ...blManualBase, items: [] }).success,
);
check(
  "create rejects unknown source types",
  !invoiceCreateSchema.safeParse({
    sourceType: "PROMO",
    sourceId: "64b000000000000000000001",
  }).success,
);

const blItemBase = { description: "CBC", unitPrice: 100, quantity: 1 };
check(
  "negative unit price rejected",
  !invoiceCreateSchema.safeParse({
    ...blManualBase,
    items: [{ ...blItemBase, unitPrice: -1 }],
  }).success,
);
check(
  "zero quantity rejected",
  !invoiceCreateSchema.safeParse({
    ...blManualBase,
    items: [{ ...blItemBase, quantity: 0 }],
  }).success,
);
check(
  "fractional quantity rejected",
  !invoiceCreateSchema.safeParse({
    ...blManualBase,
    items: [{ ...blItemBase, quantity: 1.5 }],
  }).success,
);
check(
  "unit price above cap rejected",
  !invoiceCreateSchema.safeParse({
    ...blManualBase,
    items: [{ ...blItemBase, unitPrice: MAX_ITEM_UNIT_PRICE + 1 }],
  }).success,
);
check(
  "quantity above cap rejected",
  !invoiceCreateSchema.safeParse({
    ...blManualBase,
    items: [{ ...blItemBase, quantity: MAX_ITEM_QUANTITY + 1 }],
  }).success,
);
check(
  "blank description rejected",
  !invoiceCreateSchema.safeParse({
    ...blManualBase,
    items: [{ ...blItemBase, description: "   " }],
  }).success,
);
check(
  "21 items rejected",
  !invoiceCreateSchema.safeParse({
    ...blManualBase,
    items: Array.from({ length: MAX_INVOICE_ITEMS + 1 }, (_, index) => ({
      ...blItemBase,
      description: `Item ${index}`,
    })),
  }).success,
);
check(
  "20 items accepted",
  invoiceCreateSchema.safeParse({
    ...blManualBase,
    items: Array.from({ length: MAX_INVOICE_ITEMS }, (_, index) => ({
      ...blItemBase,
      description: `Item ${index}`,
    })),
  }).success,
);
check(
  "short idempotency key rejected",
  !invoiceCreateSchema.safeParse({
    sourceType: "BOOKING",
    sourceId: "64b000000000000000000001",
    idempotencyKey: "abc",
  }).success,
);
check(
  "idempotency key with bad characters rejected",
  !invoiceCreateSchema.safeParse({
    sourceType: "BOOKING",
    sourceId: "64b000000000000000000001",
    idempotencyKey: "bad key!",
  }).success,
);

// ---- update schema ----
check(
  "issue transition passes",
  invoiceUpdateSchema.safeParse({ status: "ISSUED" }).success,
);
check(
  "void without reason fails",
  !invoiceUpdateSchema.safeParse({ status: "VOID" }).success,
);
check(
  "void with short reason fails",
  !invoiceUpdateSchema.safeParse({ status: "VOID", voidReason: "no" }).success,
);
check(
  "void with reason passes",
  invoiceUpdateSchema.safeParse({
    status: "VOID",
    voidReason: "duplicate invoice",
  }).success,
);
check(
  "DRAFT items edit passes",
  invoiceUpdateSchema.safeParse({ items: [blItemBase] }).success,
);
check(
  "direct PAID transition rejected",
  !invoiceUpdateSchema.safeParse({ status: "PAID" }).success,
);
check(
  "notes above cap rejected",
  !invoiceUpdateSchema.safeParse({ notes: "x".repeat(501) }).success,
);

// ---- payment schema ----
check(
  "valid payment passes",
  paymentCreateSchema.safeParse({
    kind: "PAYMENT",
    amount: 99.5,
    method: "UPI",
  }).success,
);
check(
  "zero amount rejected",
  !paymentCreateSchema.safeParse({
    kind: "PAYMENT",
    amount: 0,
    method: "CASH",
  }).success,
);
check(
  "negative amount rejected",
  !paymentCreateSchema.safeParse({
    kind: "REFUND",
    amount: -5,
    method: "CASH",
  }).success,
);
check(
  "string amount rejected",
  !paymentCreateSchema.safeParse({
    kind: "PAYMENT",
    amount: "100",
    method: "CASH",
  }).success,
);
check(
  "unknown method rejected",
  !paymentCreateSchema.safeParse({
    kind: "PAYMENT",
    amount: 10,
    method: "BITCOIN",
  }).success,
);
check(
  "long payment note rejected",
  !paymentCreateSchema.safeParse({
    kind: "PAYMENT",
    amount: 10,
    method: "CASH",
    note: "x".repeat(301),
  }).success,
);

// ---- list schema ----
eq(
  "list status defaults to all",
  invoiceListQuerySchema.safeParse({}).data.status,
  "all",
);
check(
  "list rejects unknown status",
  !invoiceListQuerySchema.safeParse({ status: "SETTLED" }).success,
);

// ---- DTO shapes (internal fields stripped for patients) ----
const blInvoiceDoc = {
  _id: "64b000000000000000000010",
  invoiceCode: "INV-2026-000001",
  patientId: "64b000000000000000000020",
  laboratoryId: {
    _id: "64b000000000000000000030",
    name: "Apollo Diagnostics",
    code: "APL",
  },
  sourceType: "BOOKING",
  sourceId: "64b000000000000000000040",
  sourceKey: "LAB-2026-000001",
  items: [
    {
      labTestId: "64b000000000000000000050",
      description: "CBC",
      unitPrice: 100,
      quantity: 2,
      lineTotal: 200,
    },
  ],
  subtotal: 200,
  totalAmount: 200,
  status: "ISSUED",
  notes: "internal remark",
  voidReason: null,
  createdBy: "64b000000000000000000060",
  createdAt: "2026-10-27T10:00:00.000Z",
  updatedAt: "2026-10-27T10:00:00.000Z",
};
const blPaymentRows = [
  {
    _id: "64b000000000000000000070",
    paymentCode: "PAY-2026-000001",
    kind: "PAYMENT",
    amount: 40,
    method: "CASH",
    reference: "RCP-1",
    note: "secret memo",
    receivedBy: "64b000000000000000000060",
    createdAt: "2026-10-27T11:00:00.000Z",
  },
];
const blStaffDto = toInvoiceDto(blInvoiceDoc, blPaymentRows, true);
const blPatientDto = toInvoiceDto(blInvoiceDoc, blPaymentRows, false);
eq("staff DTO balance recomputed", blStaffDto.balance, 160);
eq("staff DTO netPaid recomputed", blStaffDto.netPaid, 40);
check(
  "staff DTO carries internal notes",
  "notes" in blStaffDto && blStaffDto.notes === "internal remark",
);
check(
  "staff DTO carries payment memo + actor",
  blStaffDto.payments[0].note === "secret memo" &&
    blStaffDto.payments[0].receivedBy === "64b000000000000000000060",
);
check("patient DTO omits notes", !("notes" in blPatientDto));
check("patient DTO omits voidReason", !("voidReason" in blPatientDto));
check(
  "patient DTO omits actor ids",
  !("createdBy" in blPatientDto) && !("createdByName" in blPatientDto),
);
check("patient DTO omits events", !("events" in blPatientDto));
check(
  "patient payment rows omit memo + actor",
  !("note" in blPatientDto.payments[0]) &&
    !("receivedBy" in blPatientDto.payments[0]),
);
eq(
  "patient DTO still exposes money fields",
  blPatientDto.balance,
  160,
);

// ---- server source contracts ----
const blCounterSrc = readSrc("src", "lib", "billing", "counter.ts");
check(
  "invoice/payment counters use atomic $inc per-year series",
  blCounterSrc.includes("$inc") &&
    blCounterSrc.includes('"invoice"') &&
    blCounterSrc.includes('"payment"'),
);

const blInvoiceModelSrc = readSrc("src", "models", "Invoice.ts");
check(
  "invoice codes are unique",
  blInvoiceModelSrc.includes("invoiceCode: 1 }, { unique: true }"),
);
check(
  "one live invoice per source via partial unique activeSourceKey",
  blInvoiceModelSrc.includes("activeSourceKey: 1 }") &&
    blInvoiceModelSrc.includes("partialFilterExpression"),
);
check(
  "idempotency replay guarded by a partial unique index",
  blInvoiceModelSrc.includes("idempotencyKey: 1 }") &&
    blInvoiceModelSrc.includes("partialFilterExpression"),
);
check(
  "invoice balance is never a stored field",
  !blInvoiceModelSrc.includes("balance: {"),
);

const blPaymentModelSrc = readSrc("src", "models", "Payment.ts");
check(
  "payments are append-only ledger rows",
  blPaymentModelSrc.includes("append-only") &&
    blPaymentModelSrc.includes("NEVER updated"),
);
check(
  "payment codes are unique",
  blPaymentModelSrc.includes("paymentCode: 1 }, { unique: true }"),
);

const blEventModelSrc = readSrc("src", "models", "PaymentEvent.ts");
check(
  "invoice audit trail is append-only with a timeline index",
  blEventModelSrc.includes("append-only") &&
    blEventModelSrc.includes("invoiceId: 1, createdAt: -1"),
);

const blListRouteSrc = readSrc("src", "app", "api", "invoices", "route.ts");
check(
  "staff invoice lists are laboratory-scoped",
  blListRouteSrc.includes("scopeFilter(user)"),
);
check(
  "patient invoice lists are forced to self",
  blListRouteSrc.includes("filter.patientId = user.id"),
);
check(
  "sources must be invoiceable to be invoiced",
  blListRouteSrc.includes("cannot be invoiced in its current status"),
);
check(
  "cross-laboratory invoice creation answers 404",
  blListRouteSrc.includes("isLaboratoryInScope(user, sourceLabId)") &&
    blListRouteSrc.includes('return errorResponse(404, "Source not found.")'),
);
check(
  "duplicate active invoices answer 409",
  blListRouteSrc.includes("already has an active invoice"),
);
check(
  "idempotent creation replays the original invoice",
  blListRouteSrc.includes("idempotencyKey: input.idempotencyKey"),
);

const blDetailRouteSrc = readSrc(
  "src",
  "app",
  "api",
  "invoices",
  "[id]",
  "route.ts",
);
check(
  "voiding an issued invoice requires refunds first",
  blDetailRouteSrc.includes("Record refunds before voiding a paid invoice."),
);
check(
  "void clears the active source key",
  blDetailRouteSrc.includes("activeSourceKey: null"),
);
check(
  "stale transitions answer 409",
  blDetailRouteSrc.includes("changed - reload and retry"),
);
check(
  "read path reconciles a missed settlement",
  blDetailRouteSrc.includes("Crash-recovery") &&
    blDetailRouteSrc.includes("INVOICE_SETTLED"),
);
check(
  "DRAFT edits recompute totals server-side",
  blDetailRouteSrc.includes("lineTotals") &&
    blDetailRouteSrc.includes("editedSubtotal"),
);

const blPayRouteSrc = readSrc(
  "src",
  "app",
  "api",
  "invoices",
  "[id]",
  "payments",
  "route.ts",
);
check(
  "overpayment is blocked server-side",
  blPayRouteSrc.includes("Amount exceeds the outstanding balance."),
);
check(
  "refunds beyond net paid are blocked",
  blPayRouteSrc.includes("Amount exceeds the net paid amount."),
);
check(
  "payments require ISSUED or PAID status",
  blPayRouteSrc.includes('invoice.status !== "ISSUED" && invoice.status !== "PAID"'),
);
check(
  "full refunds revert PAID to ISSUED",
  blPayRouteSrc.includes("isFullyRefunded") &&
    blPayRouteSrc.includes("INVOICE_REVERTED"),
);
check(
  "settlement moves ISSUED to PAID on zero balance",
  blPayRouteSrc.includes("INVOICE_SETTLED"),
);
check(
  "money writes prefer a transaction with a documented fallback",
  blPayRouteSrc.includes("runInTransaction"),
);

const blTxSrc = readSrc("src", "lib", "db", "transaction.ts");
check(
  "transaction capability is probed, not assumed",
  blTxSrc.includes("transactionsSupported") && blTxSrc.includes("runInTransaction"),
);
check(
  "transaction fallback runs the work sequentially",
  blTxSrc.includes("return work(null)"),
);

const blEventsSrc = readSrc("src", "lib", "billing", "events.ts");
check(
  "audit events log failures without throwing and join transactions",
  blEventsSrc.includes("logged, not thrown") &&
    blEventsSrc.includes("session"),
);

// ---- UI wiring ----
const blPageSrc = readSrc("src", "app", "(dashboard)", "billing", "page.tsx");
check(
  "/billing gates to the billing roles",
  blPageSrc.includes("ROLES.LAB_MANAGER") &&
    blPageSrc.includes("ROLES.STAFF") &&
    blPageSrc.includes("ROLES.ADMIN") &&
    blPageSrc.includes("ROLES.SUPER_ADMIN"),
);
const blDetailPageSrc = readSrc(
  "src",
  "app",
  "(dashboard)",
  "billing",
  "[id]",
  "page.tsx",
);
check(
  "/billing/[id] opens for the invoice owner too",
  blDetailPageSrc.includes("ROLES.PATIENT"),
);
const blPanelSrc = readSrc(
  "src",
  "components",
  "billing",
  "booking-invoice-panel.tsx",
);
check(
  "booking detail offers contextual invoice creation",
  blPanelSrc.includes("Create invoice from booking") &&
    blPanelSrc.includes('sourceType: "BOOKING"'),
);
const blDetailUiSrc = readSrc(
  "src",
  "components",
  "billing",
  "invoice-detail.tsx",
);
check(
  "invoice detail exposes issue/void/payment/refund actions",
  blDetailUiSrc.includes("Issue invoice") &&
    blDetailUiSrc.includes("Record refund") &&
    blDetailUiSrc.includes("Void invoice") &&
    blDetailUiSrc.includes("voidReason"),
);
const blBookDetailSrc = readSrc(
  "src",
  "components",
  "bookings",
  "booking-detail.tsx",
);
check(
  "booking detail renders the invoice panel",
  blBookDetailSrc.includes("BookingInvoicePanel"),
);
const blNavSrc = readSrc("src", "config", "navigation.ts");
check(
  "lab managers get the billing nav tile",
  (blNavSrc.match(/Billing & Payment/g) || []).length >= 3,
);
const blDashSources = [
  readSrc("src", "app", "(dashboard)", "admin", "dashboard", "page.tsx"),
  readSrc("src", "app", "(dashboard)", "super-admin", "dashboard", "page.tsx"),
  readSrc("src", "app", "(dashboard)", "staff", "dashboard", "page.tsx"),
];
check(
  "management dashboards no longer call billing planned",
  blDashSources.every(
    (source) =>
      !source.includes("Planned - billing") &&
      source.includes("Create invoices and record payments."),
  ),
);
const blLmDashSrc = readSrc(
  "src",
  "app",
  "(dashboard)",
  "lab-manager",
  "dashboard",
  "page.tsx",
);
check(
  "lab manager dashboard links billing",
  blLmDashSrc.includes("Billing & Payment"),
);

/* ------------------------------------------------------------------ *
 * P1-3 Inventory & Stock contracts
 * ------------------------------------------------------------------ */

const ivConfigSrc = readSrc("src", "config", "inventory.ts");
check(
  "inventory categories are the approved closed set",
  ivConfigSrc.includes(
    'INVENTORY_CATEGORIES = [\n  "CONSUMABLE",\n  "REAGENT",\n  "EQUIPMENT",\n  "OTHER",\n] as const',
  ),
);
check(
  "inventory units are the approved closed set",
  ivConfigSrc.includes(
    'INVENTORY_UNITS = [\n  "PIECE",\n  "BOX",\n  "VIAL",\n  "ML",\n  "L",\n  "G",\n  "KG",\n] as const',
  ),
);
check(
  "stock movement types are IN / OUT / ADJUST only",
  ivConfigSrc.includes('STOCK_TX_TYPES = ["IN", "OUT", "ADJUST"] as const'),
);
check(
  "stock row statuses document the PENDING recovery lifecycle",
  ivConfigSrc.includes(
    'STOCK_TX_STATUSES = ["PENDING", "APPLIED", "REJECTED"] as const',
  ) && ivConfigSrc.includes("recoverable consistency strategy"),
);
check(
  "expiry state reports EXPIRED / EXPIRING / OK with a 30-day window",
  ivConfigSrc.includes("EXPIRY_WARNING_DAYS = 30") &&
    ivConfigSrc.includes('"EXPIRED" | "EXPIRING" | "OK"') &&
    ivConfigSrc.includes("export function expiryState"),
);

const ivValidationSrc = readSrc("src", "lib", "validation", "inventory.ts");
const ivCreateBlock = ivValidationSrc.slice(
  ivValidationSrc.indexOf("inventoryItemCreateSchema"),
  ivValidationSrc.indexOf("inventoryItemUpdateSchema"),
);
const ivUpdateBlock = ivValidationSrc.slice(
  ivValidationSrc.indexOf("inventoryItemUpdateSchema"),
  ivValidationSrc.indexOf("stockTxCreateSchema"),
);
check(
  "item create schema carries no quantity key at all",
  !ivCreateBlock.includes("quantity:"),
  ivCreateBlock.slice(0, 160),
);
check(
  "item update schema carries no quantity key at all",
  !ivUpdateBlock.includes("quantity:"),
  ivUpdateBlock.slice(0, 160),
);
check(
  "new items cannot open with stock (opening stock is an IN transaction)",
  !ivCreateBlock.includes("openingQuantity"),
);
check(
  "stock transactions force signed deltas (IN > 0, OUT < 0, never zero)",
  ivValidationSrc.includes("Stock IN must increase quantity") &&
    ivValidationSrc.includes("Stock OUT must decrease quantity") &&
    ivValidationSrc.includes("Quantity change must not be zero."),
);
check(
  "stock deltas are whole units",
  ivValidationSrc.includes("whole units in the smallest unit type"),
);
check(
  "inventory list query supports low-stock and expiring filters",
  ivValidationSrc.includes("lowStock: z.enum([\"true\"]).optional()") &&
    ivValidationSrc.includes("expiring: z.enum([\"true\"]).optional()") &&
    ivValidationSrc.includes("category: inventoryCategorySchema.optional()"),
);
check(
  "inventory id param uses the shared objectId schema",
  ivValidationSrc.includes("export const inventoryIdSchema = z.object({\n  id: objectIdSchema,\n});"),
);

const ivItemModelSrc = readSrc("src", "models", "InventoryItem.ts");
check(
  "item model declares quantity with a zero-floor backstop",
  ivItemModelSrc.includes("quantity: {") &&
    ivItemModelSrc.includes("min: 0,") &&
    ivItemModelSrc.includes("default: 0,"),
);
check(
  "item model enforces category and unit enums",
  ivItemModelSrc.includes("enum: INVENTORY_CATEGORIES") &&
    ivItemModelSrc.includes("enum: INVENTORY_UNITS"),
);
check(
  "item model stores the per-transaction idempotency guard",
  ivItemModelSrc.includes("appliedTxs: {") &&
    ivItemModelSrc.includes("type: [String],") &&
    ivItemModelSrc.includes("appliedTxs` holds stock-transaction ids"),
);
check(
  "item model indexes laboratory scoping and search paths",
  ivItemModelSrc.includes("index({ laboratoryId: 1, category: 1 })") &&
    ivItemModelSrc.includes("index({ laboratoryId: 1, name: 1 })"),
);
check(
  "item model carries one expiry date per row",
  ivItemModelSrc.includes("expiryDate: {"),
);

const ivTxModelSrc = readSrc("src", "models", "StockTransaction.ts");
check(
  "history rows reject zero deltas",
  ivTxModelSrc.includes("Stock deltas must be non-zero."),
);
check(
  "history rows default to PENDING with a required actor",
  ivTxModelSrc.includes('status: {') &&
    ivTxModelSrc.includes('default: "PENDING",') &&
    ivTxModelSrc.includes("performedBy: {") &&
    ivTxModelSrc.includes("required: true,"),
);
check(
  "history model registers the partial recovery index on PENDING",
  ivTxModelSrc.includes("partialFilterExpression: { status: \"PENDING\" }"),
);
check(
  "history model indexes per-item ordering",
  ivTxModelSrc.includes("itemId: 1, createdAt: -1"),
);

const ivStockSrc = readSrc("src", "lib", "inventory", "stock.ts");
check(
  "stock engine reuses the shared transaction helper",
  ivStockSrc.includes('from "@/lib/db/transaction"') &&
    ivStockSrc.includes("runInTransaction("),
);
check(
  "history row is written PENDING first (insert-before-apply strategy)",
  ivStockSrc.includes('status: "PENDING"') &&
    ivStockSrc.includes("export async function recordStockChange"),
);
check(
  "apply is idempotent per transaction (appliedTxs $ne guard)",
  ivStockSrc.includes("appliedTxs: { $ne: txId }"),
);
check(
  "negative movements are conditional decrements ($gte guard)",
  ivStockSrc.includes("guard.quantity = { $gte: -row.delta }"),
);
check(
  "insufficient stock surfaces the remaining quantity",
  ivStockSrc.includes("Insufficient stock: only"),
);
check(
  "crash windows re-finalise without double-counting",
  ivStockSrc.includes("appliedTxs.includes(txId)") &&
    ivStockSrc.includes("never apply the delta a second time"),
);
check(
  "recovery scan finalises stale PENDING rows",
  ivStockSrc.includes("export async function recoverStaleStockTransactions") &&
    ivStockSrc.includes("status: \"PENDING\",") &&
    ivStockSrc.includes("createdAt: { $lte: cutoff }"),
);
check(
  "rejected attempts keep their history row (REJECTED terminal)",
  ivStockSrc.includes("status: \"REJECTED\","),
);

const ivListRouteSrc = readSrc("src", "app", "api", "inventory", "route.ts");
check(
  "inventory list is staff-only (no patient role)",
  ivListRouteSrc.includes("ROLES.SUPER_ADMIN") &&
    ivListRouteSrc.includes("ROLES.LAB_MANAGER") &&
    !ivListRouteSrc.includes("ROLES.PATIENT"),
);
check(
  "inventory list honours laboratory scope with empty intersection",
  ivListRouteSrc.includes("Object.assign(filter, scopeFilter(user))") &&
    ivListRouteSrc.includes("? laboratoryId\n      : { $in: [] }"),
);
check(
  "low-stock filter compares quantity to reorder level in the query",
  ivListRouteSrc.includes("$expr") &&
    ivListRouteSrc.includes('$lte: ["$quantity", "$reorderLevel"]'),
);
check(
  "expiring filter includes past and near dates, never null",
  ivListRouteSrc.includes("expiryDate = { $ne: null, $lte: horizon }"),
);
check(
  "list reads run the recovery scan first",
  ivListRouteSrc.includes("await recoverStaleStockTransactions();"),
);
check(
  "item create always starts at quantity zero",
  ivListRouteSrc.includes("quantity: 0,"),
);
check(
  "item create scope-checks the target laboratory",
  ivListRouteSrc.includes("!isLaboratoryInScope(user, input.laboratoryId)") &&
    ivListRouteSrc.includes('return errorResponse(404, "Laboratory not found.")'),
);

const ivDetailRouteSrc = readSrc(
  "src",
  "app",
  "api",
  "inventory",
  "[id]",
  "route.ts",
);
check(
  "item detail rejects cross-laboratory reads with 404",
  ivDetailRouteSrc.includes("!isLaboratoryInScope(user, item.laboratoryId)") &&
    ivDetailRouteSrc.includes('errorResponse(404, "Inventory item not found.")'),
);
check(
  "item PATCH rejects quantity outright with the transaction message",
  ivDetailRouteSrc.includes("hasOwnProperty.call(body, \"quantity\")") &&
    ivDetailRouteSrc.includes(
      "Quantity changes must be recorded as stock transactions.",
    ),
);
check(
  "item PATCH has no quantity write path",
  !ivDetailRouteSrc.includes("$set.quantity") &&
    !ivDetailRouteSrc.includes("quantity:"),
);
check(
  "detail read runs the recovery scan",
  ivDetailRouteSrc.includes("await recoverStaleStockTransactions();"),
);

const ivTxRouteSrc = readSrc(
  "src",
  "app",
  "api",
  "inventory",
  "[id]",
  "transactions",
  "route.ts",
);
check(
  "movements are the only quantity writer (engine call)",
  ivTxRouteSrc.includes("recordStockChange({") &&
    !ivTxRouteSrc.includes("$inc"),
);
check(
  "equipment OUT is blocked with the approved message",
  ivTxRouteSrc.includes(
    "Equipment stock cannot be moved OUT - count corrections use ADJUST.",
  ),
);
check(
  "path id always wins over any client-supplied itemId",
  ivTxRouteSrc.includes("safeParse({ ...raw, itemId: parsedId.data.id })"),
);
check(
  "movement response returns both history row and refreshed item",
  ivTxRouteSrc.includes("transaction: toTxDto(") &&
    ivTxRouteSrc.includes("item: fresh ? toItemDto(fresh)") &&
    ivTxRouteSrc.includes("201"),
);
check(
  "history listing resolves actor names and paginates",
  ivTxRouteSrc.includes('await User.find({ _id: { $in: actorIds } })') &&
    ivTxRouteSrc.includes("actorNames.get(String(doc.performedBy))") &&
    ivTxRouteSrc.includes("buildListMeta(page, limit, total)"),
);
check(
  "movement endpoint scope-checks before acting",
  ivTxRouteSrc.includes("!isLaboratoryInScope(user, item.laboratoryId)"),
);

const ivListPageSrc = readSrc(
  "src",
  "app",
  "(dashboard)",
  "inventory",
  "page.tsx",
);
const ivDetailPageSrc = readSrc(
  "src",
  "app",
  "(dashboard)",
  "inventory",
  "[id]",
  "page.tsx",
);
check(
  "inventory pages replace the module placeholder",
  !ivListPageSrc.includes("ModulePlaceholder") &&
    !ivDetailPageSrc.includes("ModulePlaceholder"),
);
check(
  "inventory pages gate to staff roles and redirect guests",
  ivListPageSrc.includes("INVENTORY_ROLES") &&
    ivListPageSrc.includes("redirect(LOGIN_ROUTE)") &&
    ivListPageSrc.includes("redirect(getDashboardRouteForRole(user.role))") &&
    ivDetailPageSrc.includes("INVENTORY_ROLES"),
);

const ivListUiSrc = readSrc(
  "src",
  "components",
  "inventory",
  "inventory-list.tsx",
);
check(
  "list UI create flow starts items at zero (no quantity input)",
  ivListUiSrc.includes("The item starts at zero") &&
    !ivListUiSrc.includes('label="Quantity"'),
);
check(
  "list UI exposes low-stock and expiring filters",
  ivListUiSrc.includes('params.set("lowStock", "true")') &&
    ivListUiSrc.includes('params.set("expiring", "true")'),
);
check(
  "list UI opens the item detail page",
  ivListUiSrc.includes("router.push(`/inventory/${item.id}`)"),
);

const ivDetailUiSrc = readSrc(
  "src",
  "components",
  "inventory",
  "inventory-detail.tsx",
);
const ivEditPayload = ivDetailUiSrc.slice(
  ivDetailUiSrc.indexOf('"PATCH"'),
  ivDetailUiSrc.indexOf('"PATCH"') + 400,
);
check(
  "detail UI edit payload carries metadata keys, never quantity",
  ivEditPayload.includes("reorderLevel") &&
    ivEditPayload.includes("expiryDate") &&
    !ivEditPayload.includes("quantity"),
  ivEditPayload.slice(0, 200),
);
check(
  "detail UI blocks equipment OUT client-side too",
  ivDetailUiSrc.includes("outDisabled && moveType === \"OUT\"") &&
    ivDetailUiSrc.includes("Equipment stock cannot be moved OUT"),
);
check(
  "detail UI renders append-only movement history with statuses",
  ivDetailUiSrc.includes("Movement history (append-only)") &&
    ivDetailUiSrc.includes("STATUS_BADGES") &&
    ivDetailUiSrc.includes("quantityAfter"),
);

const ivStaffDashSrc = readSrc(
  "src",
  "app",
  "(dashboard)",
  "staff",
  "dashboard",
  "page.tsx",
);
const ivSaDashSrc = readSrc(
  "src",
  "app",
  "(dashboard)",
  "super-admin",
  "dashboard",
  "page.tsx",
);
check(
  "management dashboards no longer call inventory planned",
  !ivStaffDashSrc.includes("Planned - inventory") &&
    !ivSaDashSrc.includes("Planned - inventory") &&
    ivStaffDashSrc.includes("Stock items, movements and expiry alerts.") &&
    ivSaDashSrc.includes("Stock items, movements and expiry alerts."),
);

check(
  "offline suite reuses the shared transaction helper probe",
  ivStockSrc.includes("session") &&
    blTxSrc.includes("transactionsSupported"),
);

/* ------------------------------------------------------------------ *
 * Appointments and consultations (patient/doctor workflow)
 * ------------------------------------------------------------------ */

import {
  appointmentCreateSchema,
  appointmentStatusSchema,
  appointmentRescheduleSchema,
  appointmentAvailabilityQuerySchema,
  consultationUpsertSchema,
} from "@/lib/validation/appointment";
import {
  APPOINTMENT_SLOT_CAPACITY,
  CONSULTATION_CHANGE_HISTORY_LIMIT,
  MAX_PRESCRIPTION_ITEMS,
  CANCELLABLE_STATUSES,
  APPOINTMENT_CODE_PATTERN,
  canTransitionAppointmentStatus,
  appointmentStatusBadgeVariant,
  appointmentTypeLabel,
  formatAppointmentCode,
} from "@/config/appointments";
import {
  isCancellableAppointment,
  canStartAppointment,
  canCompleteAppointment,
  isConsultationEditable,
} from "@/components/appointments/shared";
import { overlapsAnyWindow } from "@/lib/utils/booking-time";

const { pickUpcomingAppointments } = await import("@/lib/utils/dashboard-rows");

/* ---- invariants and lifecycle ---- */
check(
  "appointments are single-occupancy (slot capacity 1)",
  APPOINTMENT_SLOT_CAPACITY === 1,
);
check(
  "consultation change history is capped at 50 entries",
  CONSULTATION_CHANGE_HISTORY_LIMIT === 50,
);
check(
  "prescriptions are capped at 20 items",
  MAX_PRESCRIPTION_ITEMS === 20,
);
check(
  "only pending and confirmed appointments can be cancelled or moved",
  [...CANCELLABLE_STATUSES].join(",") === "PENDING,CONFIRMED",
);

check(
  "PENDING can be confirmed",
  canTransitionAppointmentStatus("PENDING", "CONFIRMED"),
);
check(
  "PENDING can be cancelled",
  canTransitionAppointmentStatus("PENDING", "CANCELLED"),
);
check(
  "CONFIRMED can start",
  canTransitionAppointmentStatus("CONFIRMED", "IN_PROGRESS"),
);
check(
  "IN_PROGRESS can complete",
  canTransitionAppointmentStatus("IN_PROGRESS", "COMPLETED"),
);
check(
  "backward transitions are refused",
  !canTransitionAppointmentStatus("CONFIRMED", "PENDING") &&
    !canTransitionAppointmentStatus("COMPLETED", "IN_PROGRESS"),
);
check(
  "COMPLETED is terminal",
  !canTransitionAppointmentStatus("COMPLETED", "CONFIRMED") &&
    !canTransitionAppointmentStatus("COMPLETED", "CANCELLED"),
);
check(
  "CANCELLED is terminal",
  !canTransitionAppointmentStatus("CANCELLED", "PENDING"),
);
check(
  "consultations cannot skip the start step",
  !canTransitionAppointmentStatus("CONFIRMED", "COMPLETED"),
);

/* ---- UI predicates used by every appointment surface ---- */
eq(
  "isCancellableAppointment matches the lifecycle",
  ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "REJECTED"].map(
    isCancellableAppointment,
  ),
  [true, true, false, false, false, false],
);
eq(
  "canStartAppointment only accepts confirmed appointments",
  ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "REJECTED"].map(
    canStartAppointment,
  ),
  [false, true, false, false, false, false],
);
eq(
  "canCompleteAppointment only accepts in-progress appointments",
  ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "REJECTED"].map(
    canCompleteAppointment,
  ),
  [false, false, true, false, false, false],
);
eq(
  "isConsultationEditable covers in-progress and completed",
  ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "REJECTED"].map(
    isConsultationEditable,
  ),
  [false, false, true, true, false, false],
);
eq(
  "status badge variants match the shared design contract",
  ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "REJECTED", "CANCELLED"].map(
    appointmentStatusBadgeVariant,
  ),
  ["warning", "success", "info", "success", "danger", "neutral"],
);
check(
  "appointment type labels cover both supported types",
  appointmentTypeLabel("CLINIC_VISIT").length > 0 &&
    appointmentTypeLabel("ONLINE").length > 0,
);

/* ---- validation contracts ---- */
const apptBasePayload = {
  doctorId: "507f1f77bcf86cd799439011",
  appointmentDate: "2026-11-10",
  timeSlot: "10:00",
  appointmentType: "CLINIC_VISIT",
  reason: "Persistent cough",
  idempotencyKey: "booking-key-0001",
};
check(
  "valid booking payload passes",
  appointmentCreateSchema.safeParse(apptBasePayload).success,
);
check(
  "bad time format is rejected",
  !appointmentCreateSchema.safeParse({
    ...apptBasePayload,
    timeSlot: "25:99",
  }).success,
);
check(
  "impossible calendar dates are rejected",
  !appointmentCreateSchema.safeParse({
    ...apptBasePayload,
    appointmentDate: "2026-02-30",
  }).success,
);
check(
  "unknown appointment types are rejected",
  !appointmentCreateSchema.safeParse({
    ...apptBasePayload,
    appointmentType: "HOME_VISIT",
  }).success,
);
check(
  "idempotency keys must be URL-safe",
  !appointmentCreateSchema.safeParse({
    ...apptBasePayload,
    idempotencyKey: "has spaces",
  }).success,
);
check(
  "CANCELLED is never set through the status route",
  !appointmentStatusSchema.safeParse({ status: "CANCELLED" }).success,
);
check(
  "rejection without a reason fails",
  !appointmentStatusSchema.safeParse({ status: "REJECTED" }).success,
);
check(
  "rejection with a reason passes",
  appointmentStatusSchema.safeParse({
    status: "REJECTED",
    reason: "Doctor unavailable",
  }).success,
);
check(
  "reschedule payload passes",
  appointmentRescheduleSchema.safeParse({
    appointmentDate: "2026-11-11",
    timeSlot: "11:30",
  }).success,
);
check(
  "availability query requires doctor and date",
  !appointmentAvailabilityQuerySchema.safeParse({
    doctorId: "507f1f77bcf86cd799439011",
  }).success,
);
check(
  "empty consultation payload fails the content rule",
  !consultationUpsertSchema.safeParse({}).success,
);
check(
  "consultation with notes passes",
  consultationUpsertSchema.safeParse({ notes: "Reviewed." }).success,
);
const apptMedicineItem = {
  medicine: "Paracetamol 500mg",
  dosage: "500mg",
  frequency: "TDS",
  duration: "3 days",
};
check(
  "21 prescription items are rejected",
  !consultationUpsertSchema.safeParse({
    notes: "Reviewed.",
    prescriptionItems: Array.from({ length: 21 }, () => apptMedicineItem),
  }).success,
);
check(
  "20 prescription items are accepted",
  consultationUpsertSchema.safeParse({
    notes: "Reviewed.",
    prescriptionItems: Array.from({ length: 20 }, () => apptMedicineItem),
  }).success,
);

check(
  "appointment reference codes match the APT-YYYY-NNNNNN shape",
  APPOINTMENT_CODE_PATTERN.test(formatAppointmentCode(2026, 42)) &&
    formatAppointmentCode(2026, 7) === "APT-2026-000007",
);

/* ---- widget filtering mirrors the server-side scoping ---- */
const apptWidgetInput = [
  { id: "past", date: "2026-10-20", timeSlot: "09:00", status: "CONFIRMED" },
  { id: "cancelled", date: "2026-11-01", timeSlot: "10:00", status: "CANCELLED" },
  { id: "rejected", date: "2026-11-01", timeSlot: "11:00", status: "REJECTED" },
  { id: "late", date: "2026-10-30", timeSlot: "15:00", status: "PENDING" },
  { id: "early", date: "2026-10-30", timeSlot: "09:30", status: "CONFIRMED" },
];
eq(
  "appointment widget drops past/cancelled/rejected rows soonest-first",
  pickUpcomingAppointments(apptWidgetInput, "2026-10-27", 4).map(
    (row) => row.id,
  ),
  ["early", "late"],
);
eq(
  "appointment widget keeps the limit window",
  pickUpcomingAppointments(apptWidgetInput, "2026-10-01", 2).map(
    (row) => row.id,
  ),
  ["past", "early"],
);

/* ---- break windows are never bookable ---- */
check(
  "a slot overlapping a break is excluded",
  overlapsAnyWindow("13:30", 30, [{ start: "13:00", end: "14:00" }]),
);
check(
  "a slot ending exactly when the break starts is allowed",
  !overlapsAnyWindow("12:30", 30, [{ start: "13:00", end: "14:00" }]),
);
check(
  "slots away from every break are allowed",
  !overlapsAnyWindow("10:00", 30, [{ start: "13:00", end: "14:00" }]),
);

/* ---- source pins: navigation and dashboards ---- */
const apptNavSrc = readSrc("src", "config", "navigation.ts");
check(
  "base navigation offers the monitoring appointment list",
  /label: "Appointments",\s*href: "\/appointments"/.test(apptNavSrc),
);
check(
  "patient navigation links Find a Doctor",
  apptNavSrc.includes('label: "Find a Doctor"') &&
    apptNavSrc.includes('href: "/find-a-doctor"'),
);
check(
  "patient navigation links My Appointments",
  apptNavSrc.includes('label: "My Appointments"') &&
    apptNavSrc.includes('href: "/my-appointments"'),
);
check(
  "patient navigation links Medical Records",
  apptNavSrc.includes('href: "/medical-records"'),
);
check(
  "doctor navigation covers day view, all appointments, schedule and consultations",
  apptNavSrc.includes('href: "/doctor/appointments"') &&
    apptNavSrc.includes('href: "/doctor/appointments/all"') &&
    apptNavSrc.includes('href: "/doctor/schedule"') &&
    apptNavSrc.includes('href: "/doctor/consultations"'),
);

const patDashSrc = readSrc(
  "src",
  "components",
  "dashboards",
  "patient-dashboard.tsx",
);
check(
  "patient dashboard requests and narrows the appointment widget",
  patDashSrc.includes("/api/appointments?limit=25") &&
    patDashSrc.includes("pickUpcomingAppointments("),
);

const docDashSrc = readSrc(
  "src",
  "components",
  "dashboards",
  "doctor-dashboard.tsx",
);
check(
  "doctor dashboard shows today's schedule and pending reviews",
  docDashSrc.includes("?dateFrom=${today}&dateTo=${today}&limit=25") &&
    docDashSrc.includes("/api/appointments?status=PENDING&limit=10"),
);

/* ---- source pins: pages ---- */
const docAllSrc = readSrc(
  "src",
  "app",
  "(dashboard)",
  "doctor",
  "appointments",
  "all",
  "page.tsx",
);
check(
  "all-appointments page routes by path segment without search params",
  !docAllSrc.includes("useSearchParams(") &&
    docAllSrc.includes('variant="doctor"') &&
    docAllSrc.includes("user.role !== ROLES.DOCTOR"),
);

const docSchedPageSrc = readSrc(
  "src",
  "app",
  "(dashboard)",
  "doctor",
  "schedule",
  "page.tsx",
);
check(
  "unlinked doctors are redirected to the pending page",
  docSchedPageSrc.includes('redirect("/doctor/pending")'),
);
check(
  "schedule page loads the stored configuration",
  docSchedPageSrc.includes("toScheduleConfigDto"),
);

const myApptSrc = readSrc(
  "src",
  "app",
  "(dashboard)",
  "my-appointments",
  "page.tsx",
);
check(
  "my-appointments page renders the patient appointment list",
  myApptSrc.includes("MyAppointmentsList"),
);

const manageApptSrc = readSrc(
  "src",
  "app",
  "(dashboard)",
  "appointments",
  "page.tsx",
);
check(
  "monitoring page is limited to administrative roles",
  manageApptSrc.includes('user.role !== "SUPER_ADMIN"') &&
    manageApptSrc.includes("redirect(getDashboardRouteForRole"),
);

const apptDetailPageSrc = readSrc(
  "src",
  "app",
  "(dashboard)",
  "appointments",
  "[id]",
  "page.tsx",
);
check(
  "shared detail page gates every other role behind a redirect",
  apptDetailPageSrc.includes("VIEWABLE_ROLES") &&
    apptDetailPageSrc.includes("redirect(getDashboardRouteForRole"),
);

/* ---- source pins: API contracts ---- */
const apptRouteSrc = readSrc("src", "app", "api", "appointments", "route.ts");
check(
  "booking claims capacity from the shared ledger",
  apptRouteSrc.includes("claimAppointmentSlot(") &&
    apptRouteSrc.includes("APPOINTMENT_SLOT_CAPACITY"),
);
check(
  "a taken slot is refused with a 409",
  apptRouteSrc.includes(
    "The selected time slot is already taken. Choose another slot.",
  ),
);
check(
  "replayed submissions return the original appointment",
  apptRouteSrc.includes("idempotencyKey: input.idempotencyKey"),
);
check(
  "patients can only book for themselves",
  apptRouteSrc.includes("You can only create appointments for yourself."),
);
check(
  "doctors without a schedule cannot be booked",
  apptRouteSrc.includes(
    "This doctor has not configured appointment availability yet.",
  ),
);

const detailSrc = readSrc("src", "app", "api", "appointments", "[id]", "route.ts");
check(
  "unauthorised detail access surfaces as a neutral 404",
  detailSrc.includes('errorResponse(404, "Appointment not found.")'),
);
check(
  "appointment detail includes the audit history",
  detailSrc.includes("AppointmentEvent.find("),
);

const statusSrc = readSrc(
  "src",
  "app",
  "api",
  "appointments",
  "[id]",
  "status",
  "route.ts",
);
check(
  "status changes are conditional on the current status (409 on race)",
  statusSrc.includes("{ _id: appointment._id, status: currentStatus }"),
);
check(
  "start and complete belong to the treating doctor",
  statusSrc.includes(
    "Only the treating doctor can start or complete a consultation.",
  ),
);
check(
  "rejections persist their reason",
  statusSrc.includes("set.rejectionReason = reason ?? null"),
);

const cancelSrc = readSrc(
  "src",
  "app",
  "api",
  "appointments",
  "[id]",
  "cancel",
  "route.ts",
);
check(
  "cancel only touches cancellable statuses",
  cancelSrc.includes("status: { $in: [...CANCELLABLE_STATUSES] }"),
);
check(
  "cancel releases the held slot",
  cancelSrc.includes("releaseAppointmentSlotQuietly(slotKeyOf(appointment)"),
);

const reschedSrc = readSrc(
  "src",
  "app",
  "api",
  "appointments",
  "[id]",
  "reschedule",
  "route.ts",
);
const reschedClaim = reschedSrc.indexOf("await claimAppointmentSlot(");
const reschedUpdate = reschedSrc.indexOf("Appointment.findOneAndUpdate(");
const reschedReleaseOld = reschedSrc.indexOf(
  "releaseAppointmentSlotQuietly(oldKey)",
);
check(
  "reschedule claims the new slot before moving the appointment",
  reschedClaim !== -1 && reschedClaim < reschedUpdate,
);
check(
  "reschedule releases the old slot only after the move succeeds",
  reschedUpdate !== -1 && reschedUpdate < reschedReleaseOld,
);
check(
  "a failed reschedule rolls the new claim back",
  reschedSrc.includes("releaseAppointmentSlotQuietly(newKey)"),
);

const consultSrc = readSrc(
  "src",
  "app",
  "api",
  "appointments",
  "[id]",
  "consultation",
  "route.ts",
);
check(
  "patients read consultation notes only after completion",
  consultSrc.includes("becomes available once the appointment is completed"),
);
check(
  "clinical writes require an active or completed consultation",
  consultSrc.includes("Start the consultation before writing the record."),
);
check(
  "only the treating doctor may write the record",
  consultSrc.includes(
    "Only the treating doctor can write this consultation record.",
  ),
);
check(
  "change history is capped on every save",
  consultSrc.includes(".slice(0, CONSULTATION_CHANGE_HISTORY_LIMIT)"),
);

const consultListSrc = readSrc("src", "app", "api", "consultations", "route.ts");
check(
  "patient consultation list only returns released records",
  consultListSrc.includes('status: "COMPLETED"'),
);
check(
  "administrative roles never list clinical records",
  consultListSrc.includes(
    "You do not have permission to view consultation records.",
  ),
);

const availSrc = readSrc(
  "src",
  "app",
  "api",
  "appointments",
  "availability",
  "route.ts",
);
check(
  "availability never invents slots for an unconfigured schedule",
  availSrc.includes('unavailableReason: "NOT_CONFIGURED"') &&
    availSrc.includes("bookable: false"),
);
check(
  "availability reports an explicit reason for every refusal",
  [
    '"DATE_OUT_OF_RANGE"',
    '"NOT_OPERATING_DAY"',
    '"DATE_UNAVAILABLE"',
    '"DOCTOR_INACTIVE"',
    '"CLINIC_INACTIVE"',
  ].every((reason) => availSrc.includes(reason)),
);
check(
  "break windows are filtered out of the slot plan",
  availSrc.includes("overlapsAnyWindow("),
);
check(
  "slot occupancy is counted from the ledger",
  availSrc.includes("getAppointmentSlotOccupancy("),
);

const dirDetailSrc = readSrc(
  "src",
  "app",
  "api",
  "doctors",
  "directory",
  "[id]",
  "route.ts",
);
check(
  "deactivated doctors disappear from the directory",
  dirDetailSrc.includes("!doctor || !doctor.isActive"),
);

const apptDtoSrc = readSrc("src", "lib", "appointment", "dto.ts");
const dirEntryBlock = apptDtoSrc.slice(
  apptDtoSrc.indexOf("export function toDoctorDirectoryEntry"),
  apptDtoSrc.indexOf("export function toDoctorPublicProfile"),
);
check(
  "directory DTO whitelists public fields only",
  dirEntryBlock.length > 0 &&
    !dirEntryBlock.includes("email") &&
    !dirEntryBlock.includes("phone") &&
    !dirEntryBlock.includes("userId") &&
    !dirEntryBlock.includes("registrationNumber"),
  dirEntryBlock.slice(0, 120),
);

const schedPatchSrc = readSrc(
  "src",
  "app",
  "api",
  "doctors",
  "[id]",
  "availability",
  "route.ts",
);
check(
  "schedule endpoint accepts a config object or null",
  schedPatchSrc.includes("doctorScheduleConfigSchema.nullable()"),
);
check(
  "clearing a schedule unsets the config",
  schedPatchSrc.includes("$unset: { scheduleConfig"),
);

/* ---- source pins: storage guarantees ---- */
const apptModelSrc = readSrc("src", "models", "Appointment.ts");
check(
  "appointment codes are unique and idempotency keys get a partial unique index",
  apptModelSrc.includes("appointmentCode") &&
    apptModelSrc.includes("partialFilterExpression") &&
    apptModelSrc.includes("unique: true"),
);

const ledgerModelSrc = readSrc("src", "models", "AppointmentSlotLedger.ts");
check(
  "slot ledger enforces one row per doctor/date/slot",
  ledgerModelSrc.includes(
    "{ doctorId: 1, appointmentDate: 1, timeSlot: 1 }",
  ) &&
    ledgerModelSrc.slice(
      ledgerModelSrc.indexOf("appointmentSlotLedgerSchema.index("),
    ).includes("{ unique: true }"),
);

/* ---- source pins: client surfaces ---- */
const detailPanelSrc = readSrc(
  "src",
  "components",
  "appointments",
  "appointment-detail.tsx",
);
check(
  "detail panel drives status, cancel and reschedule endpoints",
  detailPanelSrc.includes("/status`") &&
    detailPanelSrc.includes("/cancel`") &&
    detailPanelSrc.includes("/reschedule`"),
);
check(
  "detail panel branches on the caller's role",
  detailPanelSrc.includes('role === "PATIENT"') &&
    detailPanelSrc.includes('role === "DOCTOR"'),
);

const editorModalSrc = readSrc(
  "src",
  "components",
  "appointments",
  "consultation-editor-modal.tsx",
);
check(
  "consultation editor upserts through the consultation endpoint",
  editorModalSrc.includes("/consultation`"),
);

const myApptListSrc = readSrc(
  "src",
  "components",
  "appointments",
  "my-appointments-list.tsx",
);
check(
  "patient list can cancel and reschedule its own appointments",
  myApptListSrc.includes("/cancel`") && myApptListSrc.includes("/reschedule`"),
);

const apptListSrc = readSrc(
  "src",
  "components",
  "appointments",
  "appointments-list.tsx",
);
check(
  "management list can confirm, reject and transition appointments",
  apptListSrc.includes("/status`") && apptListSrc.includes("/cancel`"),
);

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

console.log(`\nSTEP 9 offline auth contract tests: ${passed} passed, ${failures.length} failed.`);

if (failures.length > 0) {
  console.error("\nFailures:");
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.error("All auth contract checks passed.");
}
