import { ROLES, type Role } from "@/config/roles";

/**
 * Online Lab Booking module configuration.
 *
 * Kept dependency-free (no `server-only`, no mongoose) so client components
 * import the same statuses, transitions and defaults the server enforces.
 * All categorical strings live here - components never scatter literals.
 */

/* ------------------------------------------------------------------ *
 * Status lifecycle
 * ------------------------------------------------------------------ */

/**
 * Central booking statuses. Initial status for new bookings is PENDING.
 *
 * `REJECTED` is the lab-manager review outcome for a lab-visit request that
 * is turned down (added by the central Collection Requests workflow, exactly
 * as the home-collection lifecycle added `REJECTED` for its own review step).
 * It is terminal and distinct from `CANCELLED`, which stays the patient's
 * own cancellation - the two must never be conflated in patient history or
 * in the review queue.
 */
export const BOOKING_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "REJECTED",
  "CANCELLED",
  "COMPLETED",
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: "Pending review",
  CONFIRMED: "Confirmed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed",
};

/**
 * Explicit status transitions. Any transition not listed here is rejected on
 * the server regardless of caller role. COMPLETED is only reachable from
 * CONFIRMED through the operational status endpoint - never by date elapsed.
 * REJECTED is only reachable through the dedicated reject endpoint and is
 * terminal, so a rejected request can never be approved or completed later.
 */
export const BOOKING_STATUS_TRANSITIONS: Record<
  BookingStatus,
  readonly BookingStatus[]
> = {
  PENDING: ["CONFIRMED", "REJECTED", "CANCELLED"],
  CONFIRMED: ["CANCELLED", "COMPLETED"],
  REJECTED: [],
  CANCELLED: [],
  COMPLETED: [],
};

/** True when `to` is a valid successor of `from`. */
export function canTransitionBookingStatus(
  from: BookingStatus,
  to: BookingStatus,
): boolean {
  return BOOKING_STATUS_TRANSITIONS[from].includes(to);
}

/** Status filter values accepted by the list endpoint.
 *
 * `REVIEWED` is a filter-only value meaning "every status except PENDING" -
 * it is never a persisted status. The Online Booking management section uses
 * it so pending requests stay in the central review queue.
 */
export const BOOKING_REVIEWED_FILTER = "REVIEWED" as const;

export const BOOKING_STATUS_FILTERS = [
  "all",
  BOOKING_REVIEWED_FILTER,
  ...BOOKING_STATUSES,
] as const;

export type BookingStatusFilter = (typeof BOOKING_STATUS_FILTERS)[number];

/** Statuses that occupy capacity in a time slot. */
export const CAPACITY_HOLDING_STATUSES: readonly BookingStatus[] = [
  "PENDING",
  "CONFIRMED",
];

/* ------------------------------------------------------------------ *
 * Roles and authorization
 * ------------------------------------------------------------------ */

/**
 * Operational roles that see the management booking list and booking
 * details. STAFF follows the existing lab-module read policy; DOCTOR is
 * intentionally excluded (no unrestricted patient-booking access).
 */
export const BOOKING_MANAGEMENT_ROLES: Role[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
];

/** Roles that may confirm pending bookings or mark bookings completed. */
export const BOOKING_STATUS_WRITE_ROLES: Role[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
];

/** Roles that may cancel any booking they can view (subject to policy). */
export const BOOKING_CANCEL_ANY_ROLES: Role[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
];

/** Roles allowed to create a booking on behalf of a patient user. */
export const BOOKING_CREATE_FOR_OTHERS_ROLES: Role[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
];

/** True when the role may browse the management booking surfaces. */
export function canViewBookingManagement(role: Role): boolean {
  return BOOKING_MANAGEMENT_ROLES.includes(role);
}

/** True when the role may confirm / complete bookings. */
export function canWriteBookingStatus(role: Role): boolean {
  return BOOKING_STATUS_WRITE_ROLES.includes(role);
}

/** True when the role may cancel bookings belonging to other patients. */
export function canCancelAnyBooking(role: Role): boolean {
  return BOOKING_CANCEL_ANY_ROLES.includes(role);
}

/** True when the role may create bookings for a patient other than self. */
export function canCreateBookingForOthers(role: Role): boolean {
  return BOOKING_CREATE_FOR_OTHERS_ROLES.includes(role);
}

/** True when the role may create a booking at all. */
export function canCreateBooking(role: Role): boolean {
  return role === ROLES.PATIENT || canCreateBookingForOthers(role);
}

/* ------------------------------------------------------------------ *
 * Scheduling defaults and policy
 * ------------------------------------------------------------------ */

/**
 * Defaults applied to newly registered laboratories. Existing laboratories
 * created before this module ship without a stored configuration and are
 * treated as "booking not configured" until an admin saves one - availability
 * is never invented for them.
 */
export const DEFAULT_BOOKING_TIMEZONE = "Asia/Kolkata";

/** Monday–Saturday, 09:00–17:00, 30-minute slots, 3 bookings per slot. */
export const DEFAULT_OPERATING_DAYS = [1, 2, 3, 4, 5, 6] as const;
export const DEFAULT_OPENING_TIME = "09:00";
export const DEFAULT_CLOSING_TIME = "17:00";
export const DEFAULT_SLOT_DURATION_MINUTES = 30;
export const DEFAULT_SLOT_CAPACITY = 3;
export const DEFAULT_MAX_ADVANCE_DAYS = 30;

/** Bounds enforced by the laboratory booking-configuration validation. */
export const SLOT_DURATION_MINUTES_MIN = 15;
export const SLOT_DURATION_MINUTES_MAX = 480;
export const SLOT_CAPACITY_MIN = 1;
export const SLOT_CAPACITY_MAX = 50;
export const MAX_ADVANCE_DAYS_MIN = 1;
export const MAX_ADVANCE_DAYS_MAX = 90;

/** Weekday labels (0 = Sunday … 6 = Saturday), matching `Date#getUTCDay`. */
export const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/**
 * Bookings may be cancelled up to this many hours before the scheduled slot
 * start (interpreted in the laboratory's timezone). Applies to patients and
 * operational roles alike.
 */
export const CANCELLATION_CUTOFF_HOURS = 2;

/** Maximum number of tests selectable in a single booking. */
export const MAX_TESTS_PER_BOOKING = 20;

/** Maximum length of the optional booking note / cancellation reason. */
export const BOOKING_NOTE_MAX_LENGTH = 500;

/* ------------------------------------------------------------------ *
 * Booking reference codes
 * ------------------------------------------------------------------ */

/**
 * Formats a counter sequence value as `LAB-YYYY-NNNNNN`.
 *
 * The sequence comes from the atomic counter collection - never from
 * `countDocuments()` - so concurrent requests cannot produce duplicates and
 * cancelled bookings never free their number.
 */
export function formatBookingCode(year: number, sequence: number): string {
  return `LAB-${year}-${String(sequence).padStart(6, "0")}`;
}

/** `LAB-2026-000001` shape check, used when echoing codes in filters. */
export const BOOKING_CODE_PATTERN = /^LAB-\d{4}-\d{6}$/;

/* ------------------------------------------------------------------ *
 * Review audit history
 * ------------------------------------------------------------------ */

/** Machine-readable booking event types recorded in the audit trail. */
export const BOOKING_EVENT_TYPES = [
  "REQUEST_CREATED",
  "REQUEST_CONFIRMED",
  "REQUEST_REJECTED",
  "REQUEST_CANCELLED",
  "STATUS_CHANGED",
  "BOOKING_COMPLETED",
] as const;

export type BookingEventType = (typeof BOOKING_EVENT_TYPES)[number];

export const BOOKING_EVENT_LABELS: Record<BookingEventType, string> = {
  REQUEST_CREATED: "Request created",
  REQUEST_CONFIRMED: "Request confirmed",
  REQUEST_REJECTED: "Request rejected",
  REQUEST_CANCELLED: "Request cancelled",
  STATUS_CHANGED: "Status changed",
  BOOKING_COMPLETED: "Booking completed",
};

/* ------------------------------------------------------------------ *
 * UI helpers (client-safe)
 * ------------------------------------------------------------------ */

/** Human-readable status label, falling back to the raw value. */
export function bookingStatusLabel(status: string): string {
  return status in BOOKING_STATUS_LABELS
    ? BOOKING_STATUS_LABELS[status as BookingStatus]
    : status;
}

/** Badge variant for a booking status (shared by every booking surface). */
export function bookingStatusBadgeVariant(
  status: string,
): "warning" | "success" | "neutral" | "info" | "danger" {
  switch (status) {
    case "PENDING":
      return "warning";
    case "CONFIRMED":
      return "success";
    case "REJECTED":
      return "danger";
    case "CANCELLED":
      return "neutral";
    case "COMPLETED":
      return "info";
    default:
      return "neutral";
  }
}
