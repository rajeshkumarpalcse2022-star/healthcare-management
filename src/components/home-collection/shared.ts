import {
  COLLECTION_STATUS_FILTERS,
  collectionStatusBadgeVariant,
  collectionStatusLabel,
} from "@/config/home-collection";

/**
 * Shared client helpers for the home-collection surfaces (STEP 8).
 *
 * Formatting helpers are re-exported from the booking module (identical
 * date/price/field-error behaviour across diagnostics surfaces); only the
 * collection-specific status mapping lives here.
 */
export {
  buildQueryString,
  formatDateLabel,
  formatDateTime,
  formatPrice,
  issuesToErrors,
  type FieldErrors,
} from "@/components/bookings/shared";

/** Human-readable status label + badge variant for a collection request. */
export function collectionStatusBadge(status: string): {
  label: string;
  variant: "warning" | "success" | "neutral" | "info" | "danger" | "primary";
} {
  return {
    label: collectionStatusLabel(status),
    variant: collectionStatusBadgeVariant(status),
  };
}

/** Status filter select options for every collection list surface. */
export const COLLECTION_STATUS_OPTIONS: { value: string; label: string }[] =
  COLLECTION_STATUS_FILTERS.map((value) => ({
    value,
    label: value === "all" ? "All statuses" : collectionStatusLabel(value),
  }));
