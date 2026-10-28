import type { ApiFieldIssue } from "@/types/api";
import type { StatusFilter } from "@/config/doctors";

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

/** Formats a date-only ISO string for display (e.g. date of birth). */
export function formatBirthDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Formats a currency amount without assuming a specific currency symbol. */
export function formatFee(amount: number | null): string {
  if (amount === null || amount === undefined) return "—";
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
  }).format(amount);
}
