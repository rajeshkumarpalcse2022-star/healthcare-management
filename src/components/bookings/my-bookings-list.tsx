"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  IconCalendarCheck,
  IconEye,
  IconSearch,
  IconTrash,
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
import { useApiList, useDebouncedSearch } from "@/hooks/use-api-list";
import { apiSend, ApiRequestError } from "@/lib/api/client";
import type { ItemResponse } from "@/types/api";
import type {
  LabBookingDetail,
  LabBookingSummary,
} from "@/types/lab-booking";
import { CancelDialog } from "./cancel-dialog";
import { Pagination } from "./pagination";
import {
  buildQueryString,
  formatDateLabel,
  formatDateTime,
  formatPrice,
  issuesToErrors,
  STATUS_OPTIONS,
  statusBadge,
  type FieldErrors,
} from "./shared";

/**
 * Authenticated patient's booking history.
 *
 * Every row comes from `GET /api/lab-bookings`, which hard-scopes the query
 * to the session's own patient record - the client cannot request anyone
 * else's bookings. Cancellation requires a confirmation dialog with an
 * optional reason; completed bookings hide the action entirely.
 */
export function MyBookingsList() {
  const router = useRouter();
  const { search, setSearch, applied } = useDebouncedSearch();
  const [status, setStatus] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(10);

  const query = buildQueryString({
    search: applied || undefined,
    status,
    page,
    limit,
  });
  const { state, refresh } = useApiList<LabBookingSummary>(
    `/api/lab-bookings${query}`,
  );

  const [cancelTarget, setCancelTarget] =
    React.useState<LabBookingSummary | null>(null);
  const [cancelling, setCancelling] = React.useState(false);
  const [cancelError, setCancelError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const [prevServedPage, setPrevServedPage] = React.useState(state.meta.page);
  if (state.meta.page !== prevServedPage) {
    setPrevServedPage(state.meta.page);
    if (state.meta.total > 0 && state.meta.page !== page) {
      setPage(state.meta.page);
    }
  }

  function openCancel(booking: LabBookingSummary) {
    setActionError(null);
    setCancelError(null);
    setCancelTarget(booking);
  }

  async function handleCancel(reason: string) {
    if (!cancelTarget || cancelling) return;
    setCancelling(true);
    setCancelError(null);
    setActionError(null);

    try {
      await apiSend<ItemResponse<LabBookingDetail>>(
        `/api/lab-bookings/${cancelTarget.id}/cancel`,
        "PATCH",
        { reason: reason.length > 0 ? reason : null },
      );
      setCancelTarget(null);
      refresh();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        const fieldIssues: FieldErrors = issuesToErrors(error.issues);
        if (error.status === 400 && fieldIssues.reason) {
          setCancelError(fieldIssues.reason);
        } else {
          // Policy rejections (already cancelled, cutoff passed, ...) are
          // surfaced as a banner and the dialog closes.
          setActionError(error.message);
          setCancelTarget(null);
          refresh();
        }
      } else {
        setActionError("Unable to cancel the booking. Please try again.");
        setCancelTarget(null);
      }
    } finally {
      setCancelling(false);
    }
  }

  const { data, meta, loading, error } = state;
  const hasFilters = applied.length > 0 || status !== "all";
  const emptyTitle = hasFilters
    ? "No bookings match your filters"
    : "No bookings yet";
  const emptyDescription = hasFilters
    ? "Try adjusting the search or status filter."
    : "Book a lab test to see your bookings here.";

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input
              label="Search bookings"
              name="booking-search"
              icon={<IconSearch className="size-4" />}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Booking reference"
              containerClassName="sm:col-span-2"
            />
            <Select
              aria-label="Filter by status"
              label="Status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              options={STATUS_OPTIONS}
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
                  <TableHead>Created</TableHead>
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
                    const cancellable =
                      booking.status === "PENDING" ||
                      booking.status === "CONFIRMED";
                    return (
                      <TableRow key={booking.id}>
                        <TableCell className="font-mono text-xs font-medium text-ink">
                          {booking.bookingCode}
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
                          {formatDateTime(booking.createdAt)}
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
                            {cancellable ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openCancel(booking)}
                              >
                                <IconTrash className="size-4" />
                                Cancel
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
                const cancellable =
                  booking.status === "PENDING" ||
                  booking.status === "CONFIRMED";
                return (
                  <li key={booking.id} className="p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm font-semibold text-ink">
                          {booking.bookingCode}
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
                      {cancellable ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openCancel(booking)}
                        >
                          <IconTrash className="size-4" />
                          Cancel
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
              title="Unable to load your bookings"
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

      <CancelDialog
        open={cancelTarget !== null}
        bookingCode={cancelTarget?.bookingCode ?? ""}
        loading={cancelling}
        error={cancelError}
        onCancel={() => setCancelTarget(null)}
        onConfirm={(reason) => void handleCancel(reason)}
      />
    </div>
  );
}
