import { ROLES, type Role } from "@/config/roles";

/**
 * Patient-Doctor Appointment & Consultation module configuration.
 *
 * Kept dependency-free (no `server-only`, no mongoose) so client components
 * import the same statuses, transitions, labels and defaults the server
 * enforces. All categorical strings live here - components never scatter
 * literals.
 *
 * Payment integration is explicitly out of scope for this module:
 * `consultationFee` is informational only and is never collected, invoiced
 * or referenced by the billing module.
 */

/* ------------------------------------------------------------------ *
 * Appointment types and status lifecycle
 * ------------------------------------------------------------------ */

/** Consultation type. Both share one doctor-time capacity policy. */
export const APPOINTMENT_TYPES = ["CLINIC_VISIT", "ONLINE"] as const;

export type AppointmentType = (typeof APPOINTMENT_TYPES)[number];

export const APPOINTMENT_TYPE_LABELS: Record<AppointmentType, string> = {
  CLINIC_VISIT: "Clinic visit",
  ONLINE: "Online consultation",
};

/** Video-call providers used to auto-create online consultation links. */
export const MEETING_PROVIDERS = ["JITSI"] as const;

export type MeetingProvider = (typeof MEETING_PROVIDERS)[number];

/**
 * Appointment statuses. New patient requests start as `PENDING`.
 *
 * Lifecycle: `PENDING -> CONFIRMED -> IN_PROGRESS -> COMPLETED`, plus
 * `CANCELLED` (patient or doctor, from an active state) and `REJECTED`
 * (doctor declines a pending request). `COMPLETED` is terminal - a completed
 * consultation can never silently return to an active state. Rejected and
 * cancelled attempts are terminal and distinct from each other.
 */
export const APPOINTMENT_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
  "REJECTED",
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  PENDING: "Pending confirmation",
  CONFIRMED: "Confirmed",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REJECTED: "Rejected",
};

/**
 * Explicit status transitions. Any transition not listed here is rejected on
 * the server regardless of caller role. `IN_PROGRESS` and `COMPLETED` are
 * only reachable through the doctor's operational status endpoint.
 */
export const APPOINTMENT_STATUS_TRANSITIONS: Record<
  AppointmentStatus,
  readonly AppointmentStatus[]
> = {
  PENDING: ["CONFIRMED", "REJECTED", "CANCELLED"],
  CONFIRMED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: [],
};

/** True when `to` is a valid successor of `from`. */
export function canTransitionAppointmentStatus(
  from: AppointmentStatus,
  to: AppointmentStatus,
): boolean {
  return APPOINTMENT_STATUS_TRANSITIONS[from].includes(to);
}

/** Statuses that occupy one unit of doctor capacity in a time slot. */
export const CAPACITY_HOLDING_STATUSES: readonly AppointmentStatus[] = [
  "PENDING",
  "CONFIRMED",
  "IN_PROGRESS",
];

/** Statuses a cancellation or reschedule may start from. */
export const CANCELLABLE_STATUSES: readonly AppointmentStatus[] = [
  "PENDING",
  "CONFIRMED",
];

/** Status filter values accepted by the list endpoint. */
export const APPOINTMENT_STATUS_FILTERS = ["all", ...APPOINTMENT_STATUSES] as const;

export type AppointmentStatusFilter = (typeof APPOINTMENT_STATUS_FILTERS)[number];

/**
 * Accepted appointments that still need the doctor's attention today. Used by
 * the doctor day queue and its red remaining-appointments badge.
 */
export const APPOINTMENT_ACTIVE_STATUSES = ["CONFIRMED", "IN_PROGRESS"] as const;

export type AppointmentActiveStatus = (typeof APPOINTMENT_ACTIVE_STATUSES)[number];

/** Server-side list status filter that expands to `APPOINTMENT_ACTIVE_STATUSES`. */
export const APPOINTMENT_ACTIVE_FILTER = "ACTIVE" as const;

/** List ordering: by scheduled slot (default) or by booking time. */
export const APPOINTMENT_LIST_SORTS = ["slot", "booked"] as const;

export type AppointmentListSort = (typeof APPOINTMENT_LIST_SORTS)[number];

export const APPOINTMENT_TYPE_FILTERS = ["all", ...APPOINTMENT_TYPES] as const;

export type AppointmentTypeFilter = (typeof APPOINTMENT_TYPE_FILTERS)[number];

/* ------------------------------------------------------------------ *
 * Roles and authorization
 * ------------------------------------------------------------------ */

/** Roles that may browse the administrative appointment-monitoring list. */
export const APPOINTMENT_MANAGEMENT_ROLES: Role[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
];

/** Roles that may create an appointment on behalf of a patient user. */
export const APPOINTMENT_CREATE_FOR_OTHERS_ROLES: Role[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
];

/** Roles that may cancel appointments belonging to other patients. */
export const APPOINTMENT_CANCEL_ANY_ROLES: Role[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
];

/** True when the role may browse administrative appointment surfaces. */
export function canViewAppointmentManagement(role: Role): boolean {
  return APPOINTMENT_MANAGEMENT_ROLES.includes(role);
}

/** True when the role may confirm or reject pending requests on any clinic's behalf. */
export function canReviewAnyAppointment(role: Role): boolean {
  return APPOINTMENT_MANAGEMENT_ROLES.includes(role);
}

/** True when the role may create appointments for a patient other than self. */
export function canCreateAppointmentForOthers(role: Role): boolean {
  return APPOINTMENT_CREATE_FOR_OTHERS_ROLES.includes(role);
}

/** True when the role may create an appointment at all. */
export function canCreateAppointment(role: Role): boolean {
  return role === ROLES.PATIENT || canCreateAppointmentForOthers(role);
}

/** True when the role may cancel appointments belonging to other patients. */
export function canCancelAnyAppointment(role: Role): boolean {
  return APPOINTMENT_CANCEL_ANY_ROLES.includes(role);
}

/* ------------------------------------------------------------------ *
 * Scheduling defaults and policy
 * ------------------------------------------------------------------ */

/**
 * Defaults for a doctor's schedule configuration. A doctor without a stored
 * configuration is treated as "not configured" - availability is never
 * invented for them.
 */
export const DEFAULT_APPOINTMENT_TIMEZONE = "Asia/Kolkata";
export const DEFAULT_APPOINTMENT_OPERATING_DAYS = [1, 2, 3, 4, 5, 6] as const;
export const DEFAULT_APPOINTMENT_OPENING_TIME = "09:00";
export const DEFAULT_APPOINTMENT_CLOSING_TIME = "17:00";
export const DEFAULT_APPOINTMENT_SLOT_DURATION_MINUTES = 30;
export const DEFAULT_APPOINTMENT_MAX_ADVANCE_DAYS = 30;
export const DEFAULT_APPOINTMENT_SLOT_CAPACITY = 1;

/**
 * Legacy capacity fallback. Each clinic schedule now carries its own
 * `slotCapacity`; this constant remains the safe default for older stored
 * schedules and for code paths that have not resolved a clinic yet.
 */
export const APPOINTMENT_SLOT_CAPACITY = DEFAULT_APPOINTMENT_SLOT_CAPACITY;

/** Bounds enforced by the doctor schedule-configuration validation. */
export const APPOINTMENT_SLOT_DURATION_MINUTES_MIN = 15;
export const APPOINTMENT_SLOT_DURATION_MINUTES_MAX = 480;
export const APPOINTMENT_SLOT_CAPACITY_MIN = 1;
export const APPOINTMENT_SLOT_CAPACITY_MAX = 50;
export const APPOINTMENT_MAX_DATE_OVERRIDES = 60;
export const APPOINTMENT_MAX_CLINICS_PER_DOCTOR = 20;
export const APPOINTMENT_MAX_ADVANCE_DAYS_MIN = 1;
export const APPOINTMENT_MAX_ADVANCE_DAYS_MAX = 90;
export const APPOINTMENT_MAX_BREAKS = 10;
export const APPOINTMENT_MAX_UNAVAILABLE_DATES = 100;

/** Maximum length of the optional reason / cancellation / rejection text. */
export const APPOINTMENT_REASON_MAX_LENGTH = 500;

/** Maximum number of prescription items in one consultation record. */
export const MAX_PRESCRIPTION_ITEMS = 20;

/* ------------------------------------------------------------------ *
 * Consultation record limits
 * ------------------------------------------------------------------ */

export const CONSULTATION_NOTES_MAX_LENGTH = 2000;
export const CONSULTATION_DIAGNOSIS_MAX_LENGTH = 1000;
export const CONSULTATION_TREATMENT_MAX_LENGTH = 2000;
export const CONSULTATION_FOLLOW_UP_MAX_LENGTH = 500;

export const PRESCRIPTION_MEDICINE_MAX_LENGTH = 120;
export const PRESCRIPTION_DOSAGE_MAX_LENGTH = 80;
export const PRESCRIPTION_FREQUENCY_MAX_LENGTH = 80;
export const PRESCRIPTION_DURATION_MAX_LENGTH = 80;
export const PRESCRIPTION_INSTRUCTIONS_MAX_LENGTH = 200;

/** Optional scans, reports or a photographed prescription attached to a record. */
export const MAX_CONSULTATION_ATTACHMENTS = 8;
export const CONSULTATION_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const CONSULTATION_ATTACHMENT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const;

/** Newest audited field-change entries kept on a consultation record. */
export const CONSULTATION_CHANGE_HISTORY_LIMIT = 50;

/* ------------------------------------------------------------------ *
 * Appointment reference codes
 * ------------------------------------------------------------------ */

/**
 * Formats a counter sequence value as `APT-YYYY-NNNNNN`.
 *
 * The sequence comes from the atomic counter collection - never from
 * `countDocuments()` - so concurrent requests cannot produce duplicates and
 * cancelled appointments never free their number.
 */
export function formatAppointmentCode(year: number, sequence: number): string {
  return `APT-${year}-${String(sequence).padStart(6, "0")}`;
}

/** `APT-2026-000001` shape check, used when echoing codes in filters. */
export const APPOINTMENT_CODE_PATTERN = /^APT-\d{4}-\d{6}$/;

/* ------------------------------------------------------------------ *
 * Review audit history
 * ------------------------------------------------------------------ */

/** Machine-readable appointment event types recorded in the audit trail. */
export const APPOINTMENT_EVENT_TYPES = [
  "APPOINTMENT_CREATED",
  "APPOINTMENT_CONFIRMED",
  "APPOINTMENT_REJECTED",
  "APPOINTMENT_CANCELLED",
  "APPOINTMENT_RESCHEDULED",
  "CONSULTATION_STARTED",
  "APPOINTMENT_COMPLETED",
  "STATUS_CHANGED",
] as const;

export type AppointmentEventType = (typeof APPOINTMENT_EVENT_TYPES)[number];

export const APPOINTMENT_EVENT_LABELS: Record<AppointmentEventType, string> = {
  APPOINTMENT_CREATED: "Appointment requested",
  APPOINTMENT_CONFIRMED: "Appointment confirmed",
  APPOINTMENT_REJECTED: "Appointment rejected",
  APPOINTMENT_CANCELLED: "Appointment cancelled",
  APPOINTMENT_RESCHEDULED: "Appointment rescheduled",
  CONSULTATION_STARTED: "Consultation started",
  APPOINTMENT_COMPLETED: "Consultation completed",
  STATUS_CHANGED: "Status changed",
};

/* ------------------------------------------------------------------ *
 * UI helpers (client-safe)
 * ------------------------------------------------------------------ */

/** Human-readable appointment status label, falling back to the raw value. */
export function appointmentStatusLabel(status: string): string {
  return status in APPOINTMENT_STATUS_LABELS
    ? APPOINTMENT_STATUS_LABELS[status as AppointmentStatus]
    : status;
}

/** Badge variant for an appointment status (shared by every surface). */
export function appointmentStatusBadgeVariant(
  status: string,
): "warning" | "success" | "neutral" | "info" | "danger" {
  switch (status) {
    case "PENDING":
      return "warning";
    case "CONFIRMED":
      return "success";
    case "IN_PROGRESS":
      return "info";
    case "COMPLETED":
      return "success";
    case "REJECTED":
      return "danger";
    case "CANCELLED":
      return "neutral";
    default:
      return "neutral";
  }
}

/** Human-readable appointment type label, falling back to the raw value. */
export function appointmentTypeLabel(type: string): string {
  return type in APPOINTMENT_TYPE_LABELS
    ? APPOINTMENT_TYPE_LABELS[type as AppointmentType]
    : type;
}
