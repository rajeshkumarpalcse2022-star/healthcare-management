import {
  bookingStatusBadgeVariant,
  bookingStatusLabel,
} from "@/config/lab-bookings";
import type { ApiFieldIssue } from "@/types/api";

/** Client-side error state carried into form field maps. */
export type FieldErrors = Record<string, string>;

/** Maps server-side field issues onto form inputs. */
export function issuesToErrors(
  issues: ApiFieldIssue[] | undefined,
): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues ?? []) {
    if (!errors[issue.field]) {
      errors[issue.field] = issue.message;
    }
  }
  return errors;
}

/** Human-readable status label + badge variant for a booking. */
export function statusBadge(status: string): {
  label: string;
  variant: "warning" | "success" | "neutral" | "info" | "danger";
} {
  return {
    label: bookingStatusLabel(status),
    variant: bookingStatusBadgeVariant(status),
  };
}

/** "1 – 10 of 42" style summary text for the pagination bar. */
export function rangeLabel(page: number, limit: number, total: number): string {
  if (total === 0) return "0 results";
  const start = (page - 1) * limit + 1;
  const end = Math.min(page * limit, total);
  return `${start} – ${end} of ${total}`;
}

/** Builds a query string from a params object, skipping empty values. */
export function buildQueryString(
  params: Record<string, string | number | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "" || value === null) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

/** Formats a price without assuming a specific currency symbol. */
export function formatPrice(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Turns a `YYYY-MM-DD` string into a friendly date label. */
export function formatDateLabel(dateString: string): string {
  const [year, month, day] = dateString.split("-").map(Number);
  if (!year || !month || !day) return dateString;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** Turns a turnaround minute count into "45 min" / "12 h" / "2 d" text. */
export function formatTurnaroundLabel(minutes: number): string {
  if (minutes < 0) return "—";
  if (minutes === 0) return "Same day";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) {
    const hours = minutes / 60;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
  }
  const days = minutes / 1440;
  return `${Number.isInteger(days) ? days : days.toFixed(1)} d`;
}

/** `12 Oct 2026, 14:30`-style timestamp for createdAt values. */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** Status filter select options for the patient's own booking list. */
export const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "PENDING", label: "Pending review" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "REJECTED", label: "Rejected" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "COMPLETED", label: "Completed" },
];

/**
 * Status filter options for the Online Booking management section. Pending
 * requests are deliberately absent: they live in the central Collection
 * Requests queue (`/home-collections/manage`), so management opens on
 * `REVIEWED` - every request that already has a review decision.
 */
export const MANAGEMENT_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "REVIEWED", label: "Reviewed" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "REJECTED", label: "Rejected" },
  { value: "CANCELLED", label: "Cancelled" },
  { value: "COMPLETED", label: "Completed" },
  { value: "all", label: "All statuses (incl. pending)" },
];
