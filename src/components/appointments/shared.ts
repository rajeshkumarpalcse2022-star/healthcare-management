import {
  APPOINTMENT_STATUS_FILTERS,
  APPOINTMENT_TYPE_FILTERS,
  APPOINTMENT_TYPE_LABELS,
  CANCELLABLE_STATUSES,
  appointmentStatusBadgeVariant,
  appointmentStatusLabel,
  appointmentTypeLabel,
} from "@/config/appointments";

/**
 * Client helpers shared by every appointment surface (lists, detail view,
 * dialogs). Pure and dependency-light so the offline contract tests can
 * exercise the exact predicates the UI renders with. Query-string, date and
 * field-issue helpers are re-exported from the lab-booking module - they are
 * module-agnostic and already carry their own tests.
 */
export {
  buildQueryString,
  formatDateLabel,
  formatDateTime,
  formatPrice,
  issuesToErrors,
} from "@/components/bookings/shared";
export type { FieldErrors } from "@/components/bookings/shared";
export { appointmentTypeLabel };

/**
 * Human-readable consultation type + badge variant, so online consultations
 * and clinic visits are visually distinct on every list and detail surface.
 */
export function appointmentTypeBadge(type: string): {
  label: string;
  variant: "info" | "neutral";
} {
  return {
    label: appointmentTypeLabel(type),
    variant: type === "ONLINE" ? "info" : "neutral",
  };
}

/** Human-readable status label + badge variant for an appointment. */
export function appointmentStatusBadge(status: string): {
  label: string;
  variant: "warning" | "success" | "neutral" | "info" | "danger";
} {
  return {
    label: appointmentStatusLabel(status),
    variant: appointmentStatusBadgeVariant(status),
  };
}

/** Status filter options for every appointment list. */
export const APPOINTMENT_STATUS_OPTIONS: { value: string; label: string }[] =
  APPOINTMENT_STATUS_FILTERS.map((value) => ({
    value,
    label: value === "all" ? "All statuses" : appointmentStatusLabel(value),
  }));

/** Consultation type filter options for the management list. */
export const APPOINTMENT_TYPE_OPTIONS: { value: string; label: string }[] =
  APPOINTMENT_TYPE_FILTERS.map((value) => ({
    value,
    label: value === "all" ? "All types" : APPOINTMENT_TYPE_LABELS[value],
  }));

/** Window event fired after any appointment mutation so counters can refresh. */
export const APPOINTMENTS_CHANGED_EVENT = "appointments:changed";

/** Notify shell-level appointment counters that a mutation just succeeded. */
export function notifyAppointmentsChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(APPOINTMENTS_CHANGED_EVENT));
}

/** True when the status may still be cancelled or rescheduled. */
export function isCancellableAppointment(status: string): boolean {
  return CANCELLABLE_STATUSES.includes(status as never);
}

/** True when the doctor may start this confirmed appointment. */
export function canStartAppointment(status: string): boolean {
  return status === "CONFIRMED";
}

/** True when the doctor may mark this in-progress appointment completed. */
export function canCompleteAppointment(status: string): boolean {
  return status === "IN_PROGRESS";
}

/** True when the doctor may create or edit the consultation record. */
export function isConsultationEditable(status: string): boolean {
  return status === "IN_PROGRESS" || status === "COMPLETED";
}

/** Forward status targets the doctor's operational endpoint accepts. */
export type AppointmentTransitionTarget =
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "COMPLETED";

/** Dialog copy for the doctor's confirm / start / complete transitions. */
export const APPOINTMENT_TRANSITION_COPY: Record<
  AppointmentTransitionTarget,
  { title: string; description: string; confirm: string; cancel: string }
> = {
  CONFIRMED: {
    title: "Confirm this appointment?",
    description:
      "The patient will see the appointment as confirmed. You can still cancel it later from its detail page.",
    confirm: "Confirm appointment",
    cancel: "Not yet",
  },
  IN_PROGRESS: {
    title: "Start this consultation?",
    description:
      "The appointment moves to in progress so you can record the consultation while the patient is with you.",
    confirm: "Start consultation",
    cancel: "Keep confirmed",
  },
  COMPLETED: {
    title: "Complete this appointment?",
    description:
      "The appointment will be marked completed and the consultation record will become visible to the patient. This cannot be undone.",
    confirm: "Complete appointment",
    cancel: "Keep in progress",
  },
};
