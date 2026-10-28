"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { IconCheckCircle, IconEye, IconHome, IconSearch, IconUserCheck } from "@/components/icons";
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
import { useApiList, useDebouncedSearch } from "@/hooks/use-api-list";
import {
  canAssignCollectors,
  canWriteCollectionStatus,
} from "@/config/home-collection";
import { apiGet, apiSend, ApiRequestError } from "@/lib/api/client";
import type { ListResponse } from "@/types/api";
import type { CollectorOption, HomeCollectionSummary } from "@/types/home-collection";
import type { SafeUser } from "@/types/auth";
import { CollectorAssignDialog } from "./assign-dialog";
import { CollectionRejectDialog } from "./reject-dialog";
import {
  buildQueryString,
  COLLECTION_STATUS_OPTIONS,
  collectionStatusBadge,
  formatDateLabel,
  formatDateTime,
} from "./shared";

/**
 * Operational home-collection management list.
 *
 * Filters (reference search, status, laboratory, collector, scheduled-date
 * range) are applied server-side. Rows never carry the pickup address or
 * contact phone - those are only available on the authorised detail page.
 * Management roles are enforced by the API; this surface is only rendered for
 * roles that can view it.
 *
 * Roles that may write statuses get inline **Accept** (PENDING) and roles
 * that may assign collectors get inline **Assign** (CONFIRMED / ASSIGNED /
 * COLLECTOR_ACCEPTED) so review does not require opening every detail page.
 * STAFF keeps read-only rows; the API re-enforces every action regardless.
 */
export function HomeCollectionsList({ user }: { user: SafeUser }) {
  const router = useRouter();
  const canWrite = canWriteCollectionStatus(user.role);
  const canAssign = canAssignCollectors(user.role);
  const { search, setSearch, applied } = useDebouncedSearch();
  const [status, setStatus] = React.useState("all");
  const [laboratory, setLaboratory] = React.useState("");
  const [collector, setCollector] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(10);

  const [labs, setLabs] = React.useState<{ id: string; name: string }[]>([]);
  const [collectors, setCollectors] = React.useState<CollectorOption[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    apiGet<ListResponse<{ id: string; name: string }>>(
      "/api/home-collections/catalog",
    )
      .then((result) => {
        if (!cancelled) {
          setLabs(
            result.data.map((entry) => ({ id: entry.id, name: entry.name })),
          );
        }
      })
      .catch(() => {
        // Laboratory filter is optional; a failure just leaves it empty.
      });
    apiGet<ListResponse<CollectorOption>>("/api/home-collections/collectors")
      .then((result) => {
        if (!cancelled) setCollectors(result.data);
      })
      .catch(() => {
        // Collector filter is optional; a failure just leaves it empty.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const query = buildQueryString({
    search: applied || undefined,
    status,
    laboratory: laboratory || undefined,
    collector: collector || undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    page,
    limit,
  });
  const { state, refresh } = useApiList<HomeCollectionSummary>(
    `/api/home-collections${query}`,
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
    status !== "all" ||
    laboratory !== "" ||
    collector !== "" ||
    dateFrom !== "" ||
    dateTo !== "";

  const [rejectTarget, setRejectTarget] =
    React.useState<HomeCollectionSummary | null>(null);
  const [rejecting, setRejecting] = React.useState(false);
  const [rejectError, setRejectError] = React.useState<string | null>(null);

  const [acceptingId, setAcceptingId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const [assignTarget, setAssignTarget] =
    React.useState<HomeCollectionSummary | null>(null);
  const [assigning, setAssigning] = React.useState(false);
  const [assignError, setAssignError] = React.useState<string | null>(null);

  function canAcceptRow(collection: HomeCollectionSummary): boolean {
    return canWrite && collection.status === "PENDING";
  }

  function canAssignRow(collection: HomeCollectionSummary): boolean {
    return (
      canAssign &&
      (collection.status === "CONFIRMED" ||
        collection.status === "ASSIGNED" ||
        collection.status === "COLLECTOR_ACCEPTED")
    );
  }

  /**
   * Accept a pending request. On success the assign dialog opens straight
   * away so the lab-manager review flow is review → assign in one pass.
   */
  async function handleAccept(collection: HomeCollectionSummary) {
    if (acceptingId) return;
    setAcceptingId(collection.id);
    setActionError(null);
    try {
      await apiSend(`/api/home-collections/${collection.id}/status`, "PATCH", {
        status: "CONFIRMED",
      });
      refresh();
      if (canAssign) {
        setAssignError(null);
        setAssignTarget(collection);
      }
    } catch (err) {
      setActionError(
        err instanceof ApiRequestError
          ? err.message
          : "Unable to accept the request. Please try again.",
      );
      refresh();
    } finally {
      setAcceptingId(null);
    }
  }

  async function handleAssign(collectorId: string) {
    if (!assignTarget || assigning) return;
    setAssigning(true);
    setAssignError(null);
    try {
      await apiSend(`/api/home-collections/${assignTarget.id}/assign`, "PATCH", {
        collectorId,
      });
      setAssignTarget(null);
      refresh();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 400 && err.issues?.length) {
        setAssignError(err.issues[0].message);
      } else {
        setAssignError(
          err instanceof ApiRequestError
            ? err.message
            : "Unable to assign the collector. Please try again.",
        );
      }
    } finally {
      setAssigning(false);
    }
  }

  async function handleReject(reason: string) {
    if (!rejectTarget || rejecting) return;
    setRejecting(true);
    setRejectError(null);
    try {
      await apiSend(`/api/home-collections/${rejectTarget.id}/reject`, "PATCH", {
        reason,
      });
      setRejectTarget(null);
      refresh();
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 400 && err.issues?.length) {
        setRejectError(err.issues[0].message);
      } else {
        setRejectError(
          err instanceof ApiRequestError
            ? err.message
            : "Unable to reject the request. Please try again.",
        );
      }
    } finally {
      setRejecting(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="Search collections"
            name="manage-collection-search"
            icon={<IconSearch className="size-4" />}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Collection reference"
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
            options={COLLECTION_STATUS_OPTIONS}
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
              ...labs.map((entry) => ({ value: entry.id, label: entry.name })),
            ]}
          />
          <Select
            aria-label="Filter by collector"
            label="Collector"
            value={collector}
            onChange={(event) => {
              setCollector(event.target.value);
              setPage(1);
            }}
            options={[
              { value: "", label: "All collectors" },
              ...collectors.map((entry) => ({
                value: entry.id,
                label: entry.name,
              })),
            ]}
          />
          <Input
            label="Scheduled from"
            name="manage-date-from"
            type="date"
            value={dateFrom}
            onChange={(event) => {
              setDateFrom(event.target.value);
              setPage(1);
            }}
          />
          <Input
            label="Scheduled to"
            name="manage-date-to"
            type="date"
            value={dateTo}
            onChange={(event) => {
              setDateTo(event.target.value);
              setPage(1);
            }}
          />
          <div className="flex items-end">
            <Button
              variant="outline"
              className="w-full"
              disabled={!hasFilters}
              onClick={() => {
                setSearch("");
                setStatus("all");
                setLaboratory("");
                setCollector("");
                setDateFrom("");
                setDateTo("");
                setPage(1);
              }}
            >
              Clear filters
            </Button>
          </div>
        </div>
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
        <TableShell className="rounded-none border-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Collection</TableHead>
                <TableHead>Date & time</TableHead>
                <TableHead>Laboratory</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Collector</TableHead>
                <TableHead className="text-right">Tests</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && data === null ? (
                Array.from({ length: 5 }, (_, index) => (
                  <TableRow key={`skeleton-${index}`}>
                    <TableCell colSpan={9}>
                      <div className="skeleton h-4 w-full" />
                    </TableCell>
                  </TableRow>
                ))
              ) : data && data.length > 0 ? (
                data.map((collection) => {
                  const badge = collectionStatusBadge(collection.status);
                  return (
                    <TableRow key={collection.id}>
                      <TableCell className="font-mono text-xs font-medium text-ink">
                        {collection.collectionCode}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="min-w-0">
                          <p className="text-ink">
                            {formatDateLabel(collection.scheduledDate)}
                          </p>
                          <p className="text-xs text-ink-muted">
                            {collection.timeSlot}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-40 truncate">
                        {collection.laboratory?.name ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-36 truncate">
                        {collection.patientName ?? "—"}
                      </TableCell>
                      <TableCell className="max-w-32 truncate">
                        {collection.collector?.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {collection.itemCount}
                      </TableCell>
                      <TableCell>
                        <Badge variant={badge.variant} dot>
                          {badge.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-ink-muted">
                        {formatDateTime(collection.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              router.push(`/home-collections/${collection.id}`)
                            }
                          >
                            <IconEye className="size-4" />
                            View
                          </Button>
                          {canAcceptRow(collection) ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              loading={acceptingId === collection.id}
                              onClick={() => void handleAccept(collection)}
                            >
                              <IconCheckCircle className="size-4" />
                              Accept
                            </Button>
                          ) : null}
                          {canAssignRow(collection) ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setAssignError(null);
                                setAssignTarget(collection);
                              }}
                            >
                              <IconUserCheck className="size-4" />
                              {collection.collector ? "Reassign" : "Assign"}
                            </Button>
                          ) : null}
                          {canAcceptRow(collection) ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setRejectError(null);
                                setRejectTarget(collection);
                              }}
                            >
                              Reject
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={9}>
                    <EmptyState
                      icon={IconHome}
                      title={
                        hasFilters
                          ? "No collections match your filters"
                          : "No collection requests yet"
                      }
                      description={
                        hasFilters
                          ? "Try adjusting the search or filters."
                          : "Collection requests will appear here as patients schedule pickups."
                      }
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
            {data.map((collection) => {
              const badge = collectionStatusBadge(collection.status);
              return (
                <li key={collection.id} className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-mono text-sm font-semibold text-ink">
                        {collection.collectionCode}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink-muted">
                        {formatDateLabel(collection.scheduledDate)} ·{" "}
                        {collection.timeSlot}
                      </p>
                    </div>
                    <Badge variant={badge.variant} dot>
                      {badge.label}
                    </Badge>
                  </div>
                  <p className="mt-2 truncate text-sm text-ink-muted">
                    {collection.laboratory?.name ?? "Laboratory"} ·{" "}
                    {collection.patientName ?? "Patient"}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    {collection.itemCount} test
                    {collection.itemCount === 1 ? "" : "s"}
                    {collection.collector
                      ? ` · ${collection.collector.name}`
                      : ""}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        router.push(`/home-collections/${collection.id}`)
                      }
                    >
                      <IconEye className="size-4" />
                      View
                    </Button>
                    {canAcceptRow(collection) ? (
                      <Button
                        variant="outline"
                        size="sm"
                        loading={acceptingId === collection.id}
                        onClick={() => void handleAccept(collection)}
                      >
                        <IconCheckCircle className="size-4" />
                        Accept
                      </Button>
                    ) : null}
                    {canAssignRow(collection) ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setAssignError(null);
                          setAssignTarget(collection);
                        }}
                      >
                        <IconUserCheck className="size-4" />
                        {collection.collector ? "Reassign" : "Assign"}
                      </Button>
                    ) : null}
                    {canAcceptRow(collection) ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRejectError(null);
                          setRejectTarget(collection);
                        }}
                      >
                        Reject
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
              icon={IconHome}
              title={
                hasFilters
                  ? "No collections match your filters"
                  : "No collection requests yet"
              }
              description={
                hasFilters
                  ? "Try adjusting the search or filters."
                  : "Collection requests will appear here as patients schedule pickups."
              }
            />
          </div>
        )}
      </div>

      {actionError ? (
        <div className="p-4 sm:p-5">
          <p
            role="alert"
            className="rounded-control border border-danger-line bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
          >
            {actionError}
          </p>
        </div>
      ) : null}

      {error ? (
        <div className="p-4 sm:p-5">
          <ErrorState
            title="Unable to load collections"
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

      <CollectionRejectDialog
        open={rejectTarget !== null}
        collectionCode={rejectTarget?.collectionCode ?? ""}
        loading={rejecting}
        error={rejectError}
        onClose={() => setRejectTarget(null)}
        onConfirm={(reason) => void handleReject(reason)}
      />

      <CollectorAssignDialog
        open={assignTarget !== null}
        collectionCode={assignTarget?.collectionCode ?? ""}
        currentCollectorId={assignTarget?.collector?.id ?? null}
        loading={assigning}
        error={assignError}
        onClose={() => setAssignTarget(null)}
        onConfirm={(collectorId) => void handleAssign(collectorId)}
      />
    </Card>
  );
}
