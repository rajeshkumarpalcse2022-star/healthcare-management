import type { ApiFieldIssue } from "@/types/api";
import type { StatusFilter } from "@/config/labs";
import type { ReferenceRange } from "@/types/lab-test";

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

/** Status filter select options. */
export const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

/** Human-readable status label + badge variant for a record. */
export function statusBadge(isActive: boolean): {
  label: string;
  variant: "success" | "neutral";
} {
  return isActive
    ? { label: "Active", variant: "success" }
    : { label: "Inactive", variant: "neutral" };
}

/** "1 – 10 of 42" style summary text for the pagination bar. */
export function rangeLabel(
  page: number,
  limit: number,
  total: number,
): string {
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

/** Turns a turnaround minute count into "45 min" / "12 h" / "2 d" text. */
export function formatTurnaround(minutes: number): string {
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

/** Renders a reference range as "low – high unit", text, or an em dash. */
export function formatReferenceRange(
  range: ReferenceRange | null,
  unit?: string | null,
): string {
  if (!range) return "—";
  const suffix = unit ? ` ${unit}` : "";
  const hasLow = typeof range.low === "number";
  const hasHigh = typeof range.high === "number";
  if (hasLow && hasHigh) return `${range.low} – ${range.high}${suffix}`;
  if (hasLow) return `≥ ${range.low}${suffix}`;
  if (hasHigh) return `≤ ${range.high}${suffix}`;
  if (range.text) return range.text;
  return "—";
}

/** Renders critical bounds as "low / high" text, or an em dash. */
export function formatCritical(
  low: number | null,
  high: number | null,
): string {
  const parts: string[] = [];
  if (typeof low === "number") parts.push(`low < ${low}`);
  if (typeof high === "number") parts.push(`high > ${high}`);
  return parts.length > 0 ? parts.join(" · ") : "—";
}
