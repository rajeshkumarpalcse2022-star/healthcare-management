import {
  BOOKING_STATUSES,
  bookingStatusBadgeVariant,
  bookingStatusLabel,
  type BookingStatus,
} from "@/config/lab-bookings";
import {
  COLLECTION_STATUS_LABELS,
  collectionStatusBadgeVariant,
  type CollectionStatus,
} from "@/config/home-collection";

/**
 * Central Collection Requests queue - the shared view over every request a
 * patient can raise (a lab-visit booking or a home collection request).
 *
 * This config is deliberately a thin projection over the two existing status
 * systems: neither lifecycle gains or loses a state here, and every review
 * action still runs through the owning module's endpoint (approve/reject on
 * `/api/lab-bookings/...`, approve/reject on `/api/home-collections/...`).
 * The queue never mints its own records - it only merges read models.
 */

export const COLLECTION_REQUEST_TYPES = ["LAB_VISIT", "HOME_COLLECTION"] as const;

export type CollectionRequestType = (typeof COLLECTION_REQUEST_TYPES)[number];

export const COLLECTION_REQUEST_TYPE_LABELS: Record<
  CollectionRequestType,
  string
> = {
  LAB_VISIT: "Lab visit",
  HOME_COLLECTION: "Home collection",
};

/**
 * Union of both status enums, in lifecycle order. A status is only ever
 * reachable on the type that owns it (e.g. `ASSIGNED` never appears on a
 * lab visit, `COMPLETED` never on a home collection).
 */
export const COLLECTION_REQUEST_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "REJECTED",
  "ASSIGNED",
  "COLLECTOR_ACCEPTED",
  "COLLECTOR_EN_ROUTE",
  "ARRIVED",
  "COLLECTED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export type CollectionRequestStatus = (typeof COLLECTION_REQUEST_STATUSES)[number];

/** Statuses of either module that the queue union forgot to list. */
type MissingRequestStatus = Exclude<
  BookingStatus | CollectionStatus,
  CollectionRequestStatus
>;

/** Only `never` is allowed here: a non-covered status fails compilation. */
type AssertNever<T extends never> = T;

/**
 * Compile-time proof that the queue union still covers every status of both
 * modules: if a lifecycle gains a state and `COLLECTION_REQUEST_STATUSES` is
 * not updated, this alias stops compiling.
 */
export type QueueCoversBothModules = AssertNever<MissingRequestStatus>;

/** Status filter values accepted by the queue endpoint. */
export const COLLECTION_REQUEST_STATUS_FILTERS = [
  "all",
  ...COLLECTION_REQUEST_STATUSES,
] as const;

export type CollectionRequestStatusFilter =
  (typeof COLLECTION_REQUEST_STATUS_FILTERS)[number];

/** Type filter values accepted by the queue endpoint. */
export const COLLECTION_REQUEST_TYPE_FILTERS = ["all", ...COLLECTION_REQUEST_TYPES] as const;

export type CollectionRequestTypeFilter =
  (typeof COLLECTION_REQUEST_TYPE_FILTERS)[number];

/**
 * Row label: each type keeps its own established terminology, so a lab-visit
 * approval reads "Confirmed" while a home-collection approval reads
 * "Accepted" - exactly what the owning module shows.
 */
export function collectionRequestStatusLabel(
  requestType: CollectionRequestType,
  status: string,
): string {
  return requestType === "LAB_VISIT"
    ? bookingStatusLabel(status)
    : status in COLLECTION_STATUS_LABELS
      ? COLLECTION_STATUS_LABELS[status as keyof typeof COLLECTION_STATUS_LABELS]
      : status;
}

/**
 * Filter-option label: type-agnostic, since the filter has no type context.
 * Only `CONFIRMED` differs between the two modules; everything else shares
 * wording.
 */
export function collectionRequestFilterLabel(status: string): string {
  if (status === "CONFIRMED") return "Confirmed / Accepted";
  if ((BOOKING_STATUSES as readonly string[]).includes(status)) {
    return bookingStatusLabel(status);
  }
  return status in COLLECTION_STATUS_LABELS
    ? COLLECTION_STATUS_LABELS[status as keyof typeof COLLECTION_STATUS_LABELS]
    : status;
}

/** Badge variant for a row, delegated to the owning module's mapping. */
export function collectionRequestBadgeVariant(
  requestType: CollectionRequestType,
  status: string,
): "warning" | "success" | "neutral" | "info" | "danger" | "primary" {
  return requestType === "LAB_VISIT"
    ? bookingStatusBadgeVariant(status)
    : collectionStatusBadgeVariant(status);
}

/** True when the request is still waiting on a lab-manager review decision. */
export function isAwaitingReview(status: string): boolean {
  return status === "PENDING";
}

/** Detail-route href for a queue row (each type has its own surface). */
export function collectionRequestHref(
  requestType: CollectionRequestType,
  id: string,
): string {
  return requestType === "LAB_VISIT" ? `/lab-bookings/${id}` : `/home-collections/${id}`;
}
