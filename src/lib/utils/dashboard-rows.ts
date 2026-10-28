import { statusBadge } from "@/components/bookings/shared";
import { collectionStatusBadge } from "@/components/home-collection/shared";
import type { CollectionRequestSummary } from "@/types/collection-requests";
import type { HomeCollectionSummary } from "@/types/home-collection";
import type { LabBookingSummary } from "@/types/lab-booking";
import type { AppointmentSummary } from "@/types/appointment";

/**
 * Pure row-selection helpers for the role dashboards (Phase 2).
 *
 * Everything here is side-effect free and input-immutable so the offline
 * contract tests can exercise the exact filtering/sorting the dashboard
 * widgets render. Data comes from the existing list APIs - these helpers
 * only shape what the client already fetched.
 */

/** Browser-local calendar date as `YYYY-MM-DD` - the dashboard "today". */
export function localDateString(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

interface ScheduleParts {
  /** `YYYY-MM-DD` */
  date: string;
  /** `HH:mm` */
  timeSlot: string;
}

/** Ascending schedule order: date first, then slot start. */
function compareSchedule(a: ScheduleParts, b: ScheduleParts): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.timeSlot !== b.timeSlot) return a.timeSlot < b.timeSlot ? -1 : 1;
  return 0;
}

/**
 * Patient's upcoming appointments from the recent-bookings window.
 *
 * `GET /api/lab-bookings` has no date filter and returns `createdAt`
 * descending, so the dashboard fetches the most recent `limit` window and
 * narrows it here (Phase 2 decision D1/A1): today or later, soonest first.
 * The "View all" link on `/my-bookings` remains the complete history.
 */
export function pickUpcomingBookings(
  rows: readonly LabBookingSummary[],
  today: string,
  limit = 4,
): LabBookingSummary[] {
  return rows
    .filter((row) => row.bookingDate >= today)
    .sort((a, b) =>
      compareSchedule(
        { date: a.bookingDate, timeSlot: a.timeSlot },
        { date: b.bookingDate, timeSlot: b.timeSlot },
      ),
    )
    .slice(0, limit);
}

/**
 * Upcoming home-collection requests, soonest first.
 *
 * The collections API already supports `dateFrom`, so the server returns a
 * same-day-or-later window; the filter is kept as a defensive guard and the
 * slice caps what one compact card renders.
 */
export function pickUpcomingCollections(
  rows: readonly HomeCollectionSummary[],
  today: string,
  limit = 4,
): HomeCollectionSummary[] {
  return rows
    .filter((row) => row.scheduledDate >= today)
    .sort((a, b) =>
      compareSchedule(
        { date: a.scheduledDate, timeSlot: a.timeSlot },
        { date: b.scheduledDate, timeSlot: b.timeSlot },
      ),
    )
    .slice(0, limit);
}

/**
 * Patient's upcoming doctor appointments, soonest first, excluding
 * terminal attempts (cancelled / rejected) so the widget never advertises
 * an appointment that will not happen.
 */
export function pickUpcomingAppointments(
  rows: readonly AppointmentSummary[],
  today: string,
  limit = 4,
): AppointmentSummary[] {
  return rows
    .filter(
      (row) =>
        row.date >= today &&
        row.status !== "CANCELLED" &&
        row.status !== "REJECTED",
    )
    .sort((a, b) =>
      compareSchedule({ date: a.date, timeSlot: a.timeSlot }, { date: b.date, timeSlot: b.timeSlot }),
    )
    .slice(0, limit);
}

/**
 * Merged-queue rows in schedule order for the lab-manager "today" widgets
 * (the queue API returns `createdAt` descending).
 */
export function sortQueueBySchedule(
  rows: readonly CollectionRequestSummary[],
): CollectionRequestSummary[] {
  return [...rows].sort((a, b) =>
    compareSchedule(
      { date: a.scheduledDate, timeSlot: a.timeSlot },
      { date: b.scheduledDate, timeSlot: b.timeSlot },
    ),
  );
}

/**
 * Status label + badge variant for a merged-queue row.
 *
 * Queue rows keep the owning module's raw enum value, so the badge must be
 * built with that module's own vocabulary: bookings statuses for lab visits,
 * collection statuses for home pickups.
 */
export function queueRowStatusBadge(
  requestType: string,
  status: string,
): {
  label: string;
  variant: "warning" | "success" | "neutral" | "info" | "danger" | "primary";
} {
  return requestType === "LAB_VISIT"
    ? statusBadge(status)
    : collectionStatusBadge(status);
}
