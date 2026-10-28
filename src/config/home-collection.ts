import { ROLES, type Role } from "@/config/roles";

/**
 * Home Sample Collection module configuration (STEP 8).
 *
 * Dependency-free (no `server-only`, no mongoose) so client components import
 * the same statuses, transitions and defaults the server enforces. All
 * categorical strings live here - components never scatter literals.
 *
 * Capacity is intentionally kept DISTINCT from the STEP 7 laboratory booking
 * capacity: home collection reserves a field collector's time, not an
 * in-lab draw chair, so a laboratory may configure different hours, slot
 * durations and per-slot capacity for collection visits.
 */

/* ------------------------------------------------------------------ *
 * Status lifecycle
 * ------------------------------------------------------------------ */

/**
 * Central collection statuses. New requests start as PENDING.
 *
 * Mapped onto the workflow vocabulary where an equivalent already existed:
 * `PENDING_REVIEW` → PENDING, `ACCEPTED` → CONFIRMED,
 * `COLLECTOR_ASSIGNED` → ASSIGNED. `REJECTED` and `COLLECTOR_ACCEPTED` are
 * new states the earlier lifecycle had no equivalent for.
 */
export const COLLECTION_STATUSES = [
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
] as const;

export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];

export const COLLECTION_STATUS_LABELS: Record<CollectionStatus, string> = {
  PENDING: "Pending review",
  CONFIRMED: "Accepted",
  REJECTED: "Rejected",
  ASSIGNED: "Collector assigned",
  COLLECTOR_ACCEPTED: "Collector accepted",
  COLLECTOR_EN_ROUTE: "En route",
  ARRIVED: "Arrived",
  COLLECTED: "Collected",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
};

/**
 * Explicit status transitions. Any transition not listed here is rejected on
 * the server regardless of caller role. COLLECTED and FAILED are only
 * reachable through the operational/collector status endpoint - never by
 * date elapsed and never by an unrestricted status button. CANCELLED is only
 * reachable through the dedicated cancel endpoint.
 *
 * Failed pickups are terminal on this record: a retry creates a NEW request
 * (optionally linked via `retryOfId`) so the original failure and its audit
 * history are never rewritten.
 */
export const COLLECTION_STATUS_TRANSITIONS: Record<
  CollectionStatus,
  readonly CollectionStatus[]
> = {
  PENDING: ["CONFIRMED", "REJECTED", "CANCELLED"],
  CONFIRMED: ["ASSIGNED", "CANCELLED"],
  REJECTED: [],
  ASSIGNED: ["COLLECTOR_ACCEPTED", "CANCELLED"],
  COLLECTOR_ACCEPTED: ["COLLECTOR_EN_ROUTE", "FAILED", "CANCELLED"],
  COLLECTOR_EN_ROUTE: ["ARRIVED", "FAILED"],
  ARRIVED: ["COLLECTED", "FAILED"],
  COLLECTED: [],
  FAILED: [],
  CANCELLED: [],
};

/** True when `to` is a valid successor of `from`. */
export function canTransitionCollectionStatus(
  from: CollectionStatus,
  to: CollectionStatus,
): boolean {
  return COLLECTION_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Statuses the generic "advance status" buttons may set from `status`.
 *
 * Excludes targets that have dedicated flows and must never be reachable
 * through the unrestricted status endpoint:
 * - ASSIGNED: only the assign/reassign dialog assigns a collector
 *   (`PATCH /assign`), never `PATCH /status`;
 * - CONFIRMED / REJECTED: the accept and reject review actions;
 * - CANCELLED / FAILED: dedicated cancel and failure dialogs;
 * - COLLECTED: OTP verification endpoint.
 *
 * PENDING is never an advance target (it is the initial state only).
 * What remains - COLLECTOR_ACCEPTED, COLLECTOR_EN_ROUTE, ARRIVED - is
 * exactly the set the status endpoint accepts for progression buttons.
 */
export function collectionAdvanceTargets(
  status: CollectionStatus,
): CollectionStatus[] {
  return COLLECTION_STATUS_TRANSITIONS[status].filter(
    (next) =>
      next !== "ASSIGNED" &&
      next !== "CONFIRMED" &&
      next !== "REJECTED" &&
      next !== "CANCELLED" &&
      next !== "FAILED" &&
      next !== "COLLECTED",
  );
}

/** Status filter values accepted by the list endpoint. */
export const COLLECTION_STATUS_FILTERS = [
  "all",
  ...COLLECTION_STATUSES,
] as const;

export type CollectionStatusFilter = (typeof COLLECTION_STATUS_FILTERS)[number];

/**
 * Statuses that occupy home-collection slot capacity. CANCELLED, REJECTED
 * and FAILED release their hold; COLLECTED keeps it (the visit consumed the
 * slot, mirroring the STEP 7 completed-booking policy).
 */
export const COLLECTION_CAPACITY_HOLDING_STATUSES: readonly CollectionStatus[] =
  [
    "PENDING",
    "CONFIRMED",
    "ASSIGNED",
    "COLLECTOR_ACCEPTED",
    "COLLECTOR_EN_ROUTE",
    "ARRIVED",
    "COLLECTED",
  ];

/** Statuses from which a request may still be cancelled. */
export const COLLECTION_CANCELLABLE_STATUSES: readonly CollectionStatus[] = [
  "PENDING",
  "CONFIRMED",
  "ASSIGNED",
  "COLLECTOR_ACCEPTED",
];

/** Statuses a collector may act on (acceptance, pickup progression, failure). */
export const COLLECTION_COLLECTOR_ACTIONABLE_STATUSES: readonly CollectionStatus[] =
  ["ASSIGNED", "COLLECTOR_ACCEPTED", "COLLECTOR_EN_ROUTE", "ARRIVED"];

/** Statuses from which a collector may verify the OTP and complete. */
export const COLLECTION_OTP_VERIFIABLE_STATUSES: readonly CollectionStatus[] = [
  "COLLECTOR_ACCEPTED",
  "COLLECTOR_EN_ROUTE",
  "ARRIVED",
];

/* ------------------------------------------------------------------ *
 * Roles and authorization
 * ------------------------------------------------------------------ */

/**
 * Operational roles that see the management collection list and details.
 * STAFF follows the existing lab-module read policy; DOCTOR is intentionally
 * excluded (no unrestricted patient-collection access); COLLECTOR only ever
 * sees its own assignments through a separate scoping rule.
 */
export const COLLECTION_MANAGEMENT_ROLES: Role[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
];

/** Roles that may confirm, advance pickup statuses or record outcomes. */
export const COLLECTION_STATUS_WRITE_ROLES: Role[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
];

/** Roles that may assign or reassign collectors. */
export const COLLECTION_ASSIGN_ROLES: Role[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
];

/** Roles that may cancel any collection they can view. */
export const COLLECTION_CANCEL_ANY_ROLES: Role[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
];

/** True when the role may browse the management collection surfaces. */
export function canViewCollectionManagement(role: Role): boolean {
  return COLLECTION_MANAGEMENT_ROLES.includes(role);
}

/** True when the role may confirm / advance / complete collections. */
export function canWriteCollectionStatus(role: Role): boolean {
  return COLLECTION_STATUS_WRITE_ROLES.includes(role);
}

/** True when the role may assign or reassign collectors. */
export function canAssignCollectors(role: Role): boolean {
  return COLLECTION_ASSIGN_ROLES.includes(role);
}

/** True when the role may cancel collections belonging to other patients. */
export function canCancelAnyCollection(role: Role): boolean {
  return COLLECTION_CANCEL_ANY_ROLES.includes(role);
}

/** True when the role may create a collection request at all. */
export function canCreateCollection(role: Role): boolean {
  return (
    role === ROLES.PATIENT ||
    role === ROLES.SUPER_ADMIN ||
    role === ROLES.ADMIN
  );
}

/** True when the role may view the collector assignment surface. */
export function canViewAssignments(role: Role): boolean {
  return role === ROLES.COLLECTOR;
}

/* ------------------------------------------------------------------ *
 * Scheduling defaults and policy
 * ------------------------------------------------------------------ */

/**
 * Defaults applied when a laboratory enables home collection without a
 * stored configuration. Availability is never invented for laboratories
 * that have not enabled the service - same honesty rule as STEP 7 booking.
 */
export const DEFAULT_COLLECTION_TIMEZONE = "Asia/Kolkata";

/** Monday–Saturday, 08:00–14:00, 60-minute slots, 4 collections per slot. */
export const DEFAULT_COLLECTION_OPERATING_DAYS = [1, 2, 3, 4, 5, 6] as const;
export const DEFAULT_COLLECTION_OPENING_TIME = "08:00";
export const DEFAULT_COLLECTION_CLOSING_TIME = "14:00";
export const DEFAULT_COLLECTION_SLOT_DURATION_MINUTES = 60;
export const DEFAULT_COLLECTION_SLOT_CAPACITY = 4;
export const DEFAULT_COLLECTION_MAX_ADVANCE_DAYS = 14;

/**
 * Collections may be cancelled up to this many hours before the scheduled
 * slot start (interpreted in the laboratory's timezone). Applies to patients
 * and operational roles alike, mirroring the STEP 7 booking policy.
 */
export const COLLECTION_CANCELLATION_CUTOFF_HOURS = 2;

/** Maximum number of tests selectable in a single collection request. */
export const MAX_TESTS_PER_COLLECTION = 20;

/** Maximum length of the optional collection note / cancellation reason. */
export const COLLECTION_NOTE_MAX_LENGTH = 500;

/* ------------------------------------------------------------------ *
 * OTP verification
 * ------------------------------------------------------------------ */

/** Length of the numeric pickup OTP shown to the patient. */
export const COLLECTION_OTP_LENGTH = 6;

/** How long a generated OTP stays valid. */
export const COLLECTION_OTP_TTL_MINUTES = 15;

/** Maximum wrong attempts before an OTP is locked for that request. */
export const COLLECTION_OTP_MAX_ATTEMPTS = 5;

/**
 * Minimum seconds between two OTP regenerations by the patient. Prevents
 * OTP-farming while still letting a patient recover a lost/expired code.
 */
export const COLLECTION_OTP_REGENERATE_COOLDOWN_SECONDS = 60;

/** Regex every submitted OTP must match before hashing/lookup. */
export const COLLECTION_OTP_PATTERN = /^\d{6}$/;

/** Maximum length of the pickup failure reason. */
export const COLLECTION_FAILURE_REASON_MAX_LENGTH = 500;

/* ------------------------------------------------------------------ *
 * Collection address limits
 * ------------------------------------------------------------------ */

export const ADDRESS_NAME_MAX_LENGTH = 120;
export const ADDRESS_LINE_MAX_LENGTH = 240;
export const ADDRESS_CITY_MAX_LENGTH = 80;
export const ADDRESS_STATE_MAX_LENGTH = 80;
export const ADDRESS_LANDMARK_MAX_LENGTH = 160;
export const ADDRESS_INSTRUCTIONS_MAX_LENGTH = 500;

/** Indian PIN code (6 digits) - home collection operates in India. */
export const INDIAN_PINCODE_PATTERN = /^[1-9][0-9]{5}$/;

/* ------------------------------------------------------------------ *
 * Collection reference codes
 * ------------------------------------------------------------------ */

/**
 * Formats a counter sequence value as `HC-YYYY-NNNNNN`.
 *
 * The sequence comes from the atomic counter collection - never from
 * `countDocuments()` - so concurrent requests cannot produce duplicates and
 * cancelled collections never free their number.
 */
export function formatCollectionCode(year: number, sequence: number): string {
  return `HC-${year}-${String(sequence).padStart(6, "0")}`;
}

/** `HC-2026-000001` shape check, used when echoing codes in filters. */
export const COLLECTION_CODE_PATTERN = /^HC-\d{4}-\d{6}$/;

/* ------------------------------------------------------------------ *
 * Audit history
 * ------------------------------------------------------------------ */

/** Machine-readable collection event types recorded in the audit trail. */
export const COLLECTION_EVENT_TYPES = [
  "REQUEST_CREATED",
  "REQUEST_CONFIRMED",
  "REQUEST_REJECTED",
  "COLLECTOR_ASSIGNED",
  "COLLECTOR_REASSIGNED",
  "COLLECTOR_ACCEPTED",
  "STATUS_CHANGED",
  "REQUEST_CANCELLED",
  "COLLECTION_FAILED",
  "COLLECTION_COMPLETED",
  "OTP_REGENERATED",
] as const;

export type CollectionEventType = (typeof COLLECTION_EVENT_TYPES)[number];

export const COLLECTION_EVENT_LABELS: Record<CollectionEventType, string> = {
  REQUEST_CREATED: "Request created",
  REQUEST_CONFIRMED: "Request accepted",
  REQUEST_REJECTED: "Request rejected",
  COLLECTOR_ASSIGNED: "Collector assigned",
  COLLECTOR_REASSIGNED: "Collector reassigned",
  COLLECTOR_ACCEPTED: "Collector accepted",
  STATUS_CHANGED: "Status changed",
  REQUEST_CANCELLED: "Request cancelled",
  COLLECTION_FAILED: "Collection failed",
  COLLECTION_COMPLETED: "Collection completed",
  OTP_REGENERATED: "Pickup OTP regenerated",
};

/* ------------------------------------------------------------------ *
 * UI helpers (client-safe)
 * ------------------------------------------------------------------ */

/** Human-readable status label, falling back to the raw value. */
export function collectionStatusLabel(status: string): string {
  return status in COLLECTION_STATUS_LABELS
    ? COLLECTION_STATUS_LABELS[status as CollectionStatus]
    : status;
}

/** Badge variant for a collection status (shared by every surface). */
export function collectionStatusBadgeVariant(
  status: string,
): "warning" | "success" | "neutral" | "info" | "danger" | "primary" {
  switch (status) {
    case "PENDING":
      return "warning";
    case "CONFIRMED":
      return "info";
    case "REJECTED":
      return "danger";
    case "ASSIGNED":
      return "primary";
    case "COLLECTOR_ACCEPTED":
      return "primary";
    case "COLLECTOR_EN_ROUTE":
      return "info";
    case "ARRIVED":
      return "primary";
    case "COLLECTED":
      return "success";
    case "FAILED":
      return "danger";
    case "CANCELLED":
      return "neutral";
    default:
      return "neutral";
  }
}

/** True when the status still holds slot capacity. */
export function isCapacityHoldingStatus(status: string): boolean {
  return (COLLECTION_CAPACITY_HOLDING_STATUSES as readonly string[]).includes(
    status,
  );
}
