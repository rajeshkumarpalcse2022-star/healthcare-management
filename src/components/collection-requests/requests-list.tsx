"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  IconCalendarCheck,
  IconEye,
  IconHome,
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
import { Pagination } from "@/components/bookings/pagination";
import {
  COLLECTION_REQUEST_TYPE_LABELS,
  COLLECTION_REQUEST_TYPES,
  COLLECTION_REQUEST_STATUSES,
  collectionRequestBadgeVariant,
  collectionRequestFilterLabel,
  collectionRequestHref,
  collectionRequestStatusLabel,
} from "@/config/collection-requests";
import { useApiList, useDebouncedSearch } from "@/hooks/use-api-list";
import { apiGet } from "@/lib/api/client";
import type { ListResponse } from "@/types/api";
import type { CollectionRequestSummary } from "@/types/collection-requests";
import {
  buildQueryString,
  formatDateLabel,
  formatDateTime,
  formatPrice,
  rangeLabel,
} from "@/components/bookings/shared";

const TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All request types" },
  ...COLLECTION_REQUEST_TYPES.map((value) => ({
    value,
    label: COLLECTION_REQUEST_TYPE_LABELS[value],
  })),
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All statuses" },
  ...COLLECTION_REQUEST_STATUSES.map((value) => ({
    value,
    label: collectionRequestFilterLabel(value),
  })),
];

/**
 * Central Collection Requests queue: every lab-visit booking and every home
 * collection request in one review list, straight from `/api/collection-requests`
 * (a read-only merge of the two existing stores - approvals recorded in
 * either module show up here immediately and are never duplicated).
 *
 * Rows are deliberately action-light: **View** opens the owning module's
 * detail page, where approve / reject / assign run against the module's own
 * endpoints. Rows carry the patient name only - contact details and pickup
 * addresses stay on the authorised detail pages.
 */
export function CollectionRequestsList() {
  const router = useRouter();
  const { search, setSearch, applied } = useDebouncedSearch();
  const [type, setType] = React.useState("all");
  const [status, setStatus] = React.useState("all");
  const [laboratory, setLaboratory] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(10);

  const [laboratories, setLaboratories] = React.useState<
    { id: string; name: string }[]
  >([]);
  React.useEffect(() => {
    let cancelled = false;
    apiGet<ListResponse<{ id: string; name: string }>>(
      "/api/laboratories?status=active&limit=50",
    )
      .then((result) => {
        if (!cancelled) {
          setLaboratories(
            result.data.map((entry) => ({ id: entry.id, name: entry.name })),
          );
        }
      })
      .catch(() => {
        // Laboratory filter is optional; a failure just leaves it empty.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const query = buildQueryString({
    search: applied || undefined,
    type,
    status,
    laboratory: laboratory || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    limit,
  });
  const { state, refresh } = useApiList<CollectionRequestSummary>(
    `/api/collection-requests${query}`,
  );

  const [prevServedPage, setPrevServedPage] = React.useState(state.meta.page);
  if (state.meta.page !== prevServedPage) {
    setPrevServedPage(state.meta.page);
    if (state.meta.total > 0 && state.meta.page !== page) {
      setPage(state.meta.page);
    }
  }

  const { data, meta, loading, error } = state;
  const hasFilters =
    applied.length > 0 ||
    type !== "all" ||
    status !== "all" ||
    laboratory !== "" ||
    dateFrom !== "" ||
    dateTo !== "";
  const emptyTitle = hasFilters
    ? "No requests match your filters"
    : "No requests yet";
  const emptyDescription = hasFilters
    ? "Try adjusting the search or filters."
    : "Lab-visit and home-collection requests raised by patients will appear here.";

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Input
              label="Search requests"
              name="collection-request-search"
              icon={<IconSearch className="size-4" />}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Reference or patient name"
            />
            <Select
              aria-label="Filter by request type"
              label="Request type"
              value={type}
              onChange={(event) => {
                setType(event.target.value);
                setPage(1);
              }}
              options={TYPE_OPTIONS}
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
            <Input
              label="Scheduled from"
              name="collection-request-date-from"
              type="date"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value);
                setPage(1);
              }}
            />
            <Input
              label="Scheduled to"
              name="collection-request-date-to"
              type="date"
              value={dateTo}
              onChange={(event) => {
                setDateTo(event.target.value);
                setPage(1);
              }}
            />
          </div>
          <p className="text-xs text-ink-subtle">
            Showing {rangeLabel(page, limit, meta?.total ?? 0)} · approvals and
            rejections happen on each request&apos;s own detail page.
          </p>
        </div>

        {/* Desktop table */}
        <div className="hidden md:block">
          <TableShell className="rounded-none border-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Request</TableHead>
                  <TableHead>Patient</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Laboratory</TableHead>
                  <TableHead className="text-right">Tests</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
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
                  data.map((row) => {
                    const badge = collectionRequestBadgeVariant(
                      row.requestType,
                      row.status,
                    );
                    const typeLabel =
                      COLLECTION_REQUEST_TYPE_LABELS[row.requestType];
                    return (
                      <TableRow key={`${row.requestType}-${row.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {row.requestType === "LAB_VISIT" ? (
                              <IconCalendarCheck
                                className="size-4 shrink-0 text-ink-subtle"
                                aria-hidden="true"
                              />
                            ) : (
                              <IconHome
                                className="size-4 shrink-0 text-ink-subtle"
                                aria-hidden="true"
                              />
                            )}
                            <div className="min-w-0">
                              <p className="truncate font-mono text-xs font-medium text-ink">
                                {row.reference}
                              </p>
                              <p className="truncate text-xs text-ink-muted">
                                {typeLabel}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-40 truncate">
                          {row.patientName ?? "—"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="min-w-0">
                            <p className="text-ink">
                              {formatDateLabel(row.scheduledDate)}
                            </p>
                            <p className="text-xs text-ink-muted">
                              {row.timeSlot}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-40 truncate">
                          {row.laboratory?.name ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.itemCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatPrice(row.totalAmount)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={badge} dot>
                            {collectionRequestStatusLabel(
                              row.requestType,
                              row.status,
                            )}
                          </Badge>
                          {row.reviewedAt ? (
                            <p className="mt-1 whitespace-nowrap text-xs text-ink-subtle">
                              Reviewed {formatDateTime(row.reviewedAt)}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                router.push(
                                  collectionRequestHref(row.requestType, row.id),
                                )
                              }
                            >
                              <IconEye className="size-4" />
                              View
                            </Button>
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
              {data.map((row) => {
                const badge = collectionRequestBadgeVariant(
                  row.requestType,
                  row.status,
                );
                const statusLabel = collectionRequestStatusLabel(
                  row.requestType,
                  row.status,
                );
                return (
                  <li
                    key={`${row.requestType}-${row.id}`}
                    className="p-4 sm:p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm font-semibold text-ink">
                          {row.reference}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-ink-muted">
                          {COLLECTION_REQUEST_TYPE_LABELS[row.requestType]} ·{" "}
                          {row.patientName ?? "Unknown patient"}
                        </p>
                      </div>
                      <Badge variant={badge} dot>
                        {statusLabel}
                      </Badge>
                    </div>
                    <p className="mt-2 truncate text-sm text-ink-muted">
                      {formatDateLabel(row.scheduledDate)} · {row.timeSlot}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-ink-muted">
                      {row.laboratory?.name ?? "Laboratory"} ·{" "}
                      {row.itemCount} test{row.itemCount === 1 ? "" : "s"}
                      {row.totalAmount !== null
                        ? ` · ${formatPrice(row.totalAmount)}`
                        : ""}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          router.push(
                            collectionRequestHref(row.requestType, row.id),
                          )
                        }
                      >
                        <IconEye className="size-4" />
                        View
                      </Button>
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
              title="Unable to load requests"
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
    </div>
  );
}
