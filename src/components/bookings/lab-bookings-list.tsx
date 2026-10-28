"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  IconCalendarCheck,
  IconCheckCircle,
  IconEye,
  IconSearch,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableShell,
} from "@/components/ui/table";
import { canWriteBookingStatus } from "@/config/lab-bookings";
import type { Role } from "@/config/roles";
import { useApiList, useDebouncedSearch } from "@/hooks/use-api-list";
import { apiGet, apiSend, ApiRequestError } from "@/lib/api/client";
import type { ItemResponse, ListResponse } from "@/types/api";
import type {
  LabBookingDetail,
  LabBookingSummary,
} from "@/types/lab-booking";
import type { Laboratory } from "@/types/laboratory";
import { ConfirmDialog } from "./confirm-dialog";
import { Pagination } from "./pagination";
import {
  buildQueryString,
  formatDateLabel,
  formatDateTime,
  formatPrice,
  MANAGEMENT_STATUS_OPTIONS,
  statusBadge,
} from "./shared";

export interface LabBookingsListProps {
  role: Role;
}

/**
 * Operational booking management list for permitted roles (super admin,
 * admin, lab manager, staff). Server-side search, status and laboratory
 * filters with pagination; confirm / complete quick actions appear only for
 * roles that hold the status-write permission - the API re-checks on every
 * request regardless.
 *
 * Opens on `REVIEWED`: pending requests are worked from the central
 * Collection Requests queue (`/home-collections/manage`), so this list shows
 * the decisions and their downstream lifecycle. Selecting "All statuses
 * (incl. pending)" surfaces pending rows here too, with the same quick
 * actions.
 */
export function LabBookingsList({ role }: LabBookingsListProps) {
  const router = useRouter();
  const { search, setSearch, applied } = useDebouncedSearch();
  const [status, setStatus] = React.useState("REVIEWED");
  const [laboratory, setLaboratory] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(10);

  const query = buildQueryString({
    search: applied || undefined,
    status,
    laboratory: laboratory || undefined,
    page,
    limit,
  });
  const { state, refresh } = useApiList<LabBookingSummary>(
    `/api/lab-bookings${query}`,
  );

  const canWriteStatus = canWriteBookingStatus(role);

  const [laboratories, setLaboratories] = React.useState<Laboratory[]>([]);
  React.useEffect(() => {
    let cancelled = false;
    apiGet<ListResponse<Laboratory>>(
      "/api/laboratories?status=active&limit=50",
    )
      .then((result) => {
        if (!cancelled) setLaboratories(result.data);
      })
      .catch(() => {
        // Directory is only a filter convenience; the list still works.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [statusTarget, setStatusTarget] = React.useState<{
    booking: LabBookingSummary;
    next: "CONFIRMED" | "COMPLETED";
  } | null>(null);
  const [statusLoading, setStatusLoading] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const [prevServedPage, setPrevServedPage] = React.useState(state.meta.page);
  if (state.meta.page !== prevServedPage) {
    setPrevServedPage(state.meta.page);
    if (state.meta.total > 0 && state.meta.page !== page) {
      setPage(state.meta.page);
    }
  }

  async function applyStatus() {
    if (!statusTarget || statusLoading) return;
    setStatusLoading(true);
    setActionError(null);

    try {
      await apiSend<ItemResponse<LabBookingDetail>>(
        `/api/lab-bookings/${statusTarget.booking.id}/status`,
        "PATCH",
        { status: statusTarget.next },
      );
      setStatusTarget(null);
      refresh();
    } catch (error) {
      setStatusTarget(null);
      setActionError(
        error instanceof ApiRequestError
          ? error.message
          : "Unable to update the booking status.",
      );
    } finally {
      setStatusLoading(false);
    }
  }

  const { data, meta, loading, error } = state;
  const hasFilters =
    applied.length > 0 || status !== "REVIEWED" || laboratory.length > 0;
  const emptyTitle = hasFilters
    ? "No bookings match your filters"
    : "No reviewed bookings yet";
  const emptyDescription = hasFilters
    ? "Try adjusting the search or filters."
    : "Bookings appear here once a lab manager has approved or rejected them. Pending requests live in the Collection requests queue.";

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Input
              label="Search bookings"
              name="management-booking-search"
              icon={<IconSearch className="size-4" />}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Booking reference"
            />
            <Select
              aria-label="Filter by status"
              label="Status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              options={MANAGEMENT_STATUS_OPTIONS}
            />
            <Select
              aria-label="Filter by laboratory"
              label="Laboratory"
              value={laboratory}
              onChange={(event) => {
                setLaboratory(event.target.value);
                setPage(1);
              }}
              options={[
                { value: "", label: "All laboratories" },
                ...laboratories.map((entry) => ({
                  value: entry.id,
                  label: entry.name,
                })),
              ]}
            />
          </div>
        </div>

        {actionError ? (
          <p
            role="alert"
            className="border-t border-danger-line bg-danger-soft px-4 py-2.5 text-sm text-danger sm:px-5"
          >
            {actionError}
          </p>
        ) : null}

        {/* Desktop table */}
        <div className="hidden md:block">
          <TableShell className="rounded-none border-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Booking</TableHead>
                  <TableHead>Date & time</TableHead>
                  <TableHead>Laboratory</TableHead>
                  <TableHead className="text-right">Tests</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reviewed</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && data === null ? (
                  Array.from({ length: 5 }, (_, index) => (
                    <TableRow key={`skeleton-${index}`}>
                      <TableCell colSpan={8}>
                        <div className="skeleton h-4 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : data && data.length > 0 ? (
                  data.map((booking) => {
                    const badge = statusBadge(booking.status);
                    return (
                      <TableRow key={booking.id}>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate font-mono text-xs font-medium text-ink">
                              {booking.bookingCode}
                            </p>
                            <p className="truncate text-xs text-ink-muted">
                              {booking.patientName ?? "—"}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="min-w-0">
                            <p className="text-ink">
                              {formatDateLabel(booking.bookingDate)}
                            </p>
                            <p className="text-xs text-ink-muted">
                              {booking.timeSlot}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-40 truncate">
                          {booking.laboratory?.name ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {booking.itemCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatPrice(booking.totalAmount)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={badge.variant} dot>
                            {badge.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-ink-muted">
                          {booking.reviewedAt
                            ? formatDateTime(booking.reviewedAt)
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                router.push(`/lab-bookings/${booking.id}`)
                              }
                            >
                              <IconEye className="size-4" />
                              View
                            </Button>
                            {canWriteStatus && booking.status === "PENDING" ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setStatusTarget({
                                    booking,
                                    next: "CONFIRMED",
                                  })
                                }
                              >
                                <IconCheckCircle className="size-4" />
                                Confirm
                              </Button>
                            ) : null}
                            {canWriteStatus &&
                            booking.status === "CONFIRMED" ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  setStatusTarget({
                                    booking,
                                    next: "COMPLETED",
                                  })
                                }
                              >
                                <IconCheckCircle className="size-4" />
                                Complete
                              </Button>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <EmptyState
                        icon={IconCalendarCheck}
                        title={emptyTitle}
                        description={emptyDescription}
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableShell>
        </div>

        {/* Mobile / tablet cards */}
        <div className="md:hidden">
          {loading && data === null ? (
            <div className="space-y-3 p-4" aria-hidden="true">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="skeleton h-24 w-full rounded-card" />
              ))}
            </div>
          ) : data && data.length > 0 ? (
            <ul className="divide-y divide-border">
              {data.map((booking) => {
                const badge = statusBadge(booking.status);
                return (
                  <li key={booking.id} className="p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm font-semibold text-ink">
                          {booking.bookingCode}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-ink-muted">
                          {booking.patientName ?? "Unknown patient"}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-ink-muted">
                          {formatDateLabel(booking.bookingDate)} ·{" "}
                          {booking.timeSlot}
                        </p>
                      </div>
                      <Badge variant={badge.variant} dot>
                        {badge.label}
                      </Badge>
                    </div>
                    <p className="mt-2 truncate text-sm text-ink-muted">
                      {booking.laboratory?.name ?? "Laboratory"}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-muted">
                      {booking.itemCount} test
                      {booking.itemCount === 1 ? "" : "s"} ·{" "}
                      {formatPrice(booking.totalAmount)}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/lab-bookings/${booking.id}`)}
                      >
                        <IconEye className="size-4" />
                        View
                      </Button>
                      {canWriteStatus && booking.status === "PENDING" ? (
                        <Button
                          size="sm"
                          onClick={() =>
                            setStatusTarget({ booking, next: "CONFIRMED" })
                          }
                        >
                          <IconCheckCircle className="size-4" />
                          Confirm
                        </Button>
                      ) : null}
                      {canWriteStatus && booking.status === "CONFIRMED" ? (
                        <Button
                          size="sm"
                          onClick={() =>
                            setStatusTarget({ booking, next: "COMPLETED" })
                          }
                        >
                          <IconCheckCircle className="size-4" />
                          Complete
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="p-4 sm:p-5">
              <EmptyState
                icon={IconCalendarCheck}
                title={emptyTitle}
                description={emptyDescription}
              />
            </div>
          )}
        </div>

        {error ? (
          <div className="p-4 sm:p-5">
            <ErrorState
              title="Unable to load bookings"
              description={error}
              onRetry={refresh}
            />
          </div>
        ) : null}

        {!loading && data && data.length > 0 ? (
          <Pagination
            meta={meta}
            onPageChange={setPage}
            onLimitChange={(next) => {
              setLimit(next);
              setPage(1);
            }}
          />
        ) : null}
      </Card>

      {/* Status confirmation */}
      <ConfirmDialog
        open={statusTarget !== null}
        title={
          statusTarget?.next === "COMPLETED"
            ? "Mark as completed?"
            : "Confirm booking?"
        }
        description={
          statusTarget
            ? statusTarget.next === "CONFIRMED"
              ? `Booking ${statusTarget.booking.bookingCode} will be confirmed for the patient.`
              : `Booking ${statusTarget.booking.bookingCode} will be marked completed.`
            : ""
        }
        confirmLabel={statusTarget?.next === "COMPLETED" ? "Complete" : "Confirm"}
        cancelLabel="Not now"
        tone="primary"
        loading={statusLoading}
        onCancel={() => setStatusTarget(null)}
        onConfirm={() => void applyStatus()}
      />
    </div>
  );
}
