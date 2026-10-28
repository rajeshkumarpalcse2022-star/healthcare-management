"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  IconEye,
  IconHome,
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
import { Pagination } from "@/components/bookings/pagination";
import { useApiList, useDebouncedSearch } from "@/hooks/use-api-list";
import { apiSend, ApiRequestError } from "@/lib/api/client";
import type { ItemResponse } from "@/types/api";
import type { HomeCollectionDetail, HomeCollectionSummary } from "@/types/home-collection";
import { CollectionCancelDialog } from "./cancel-dialog";
import { CollectionFailureDialog } from "./failure-dialog";
import {
  buildQueryString,
  COLLECTION_STATUS_OPTIONS,
  collectionStatusBadge,
  formatDateLabel,
  formatDateTime,
  issuesToErrors,
  type FieldErrors,
} from "./shared";

export interface MyCollectionsListProps {
  /**
   * - `patient`: hard-scoped server-side to the session's own requests; cancel
   *   is offered when the row is cancellable.
   * - `collector`: hard-scoped server-side to requests assigned to the
   *   session's collector; the pickup progression actions are offered.
   */
  mode: "patient" | "collector";
}

/**
 * Patient collection history / collector assignment board.
 *
 * Every row comes from `GET /api/home-collections`, which hard-scopes the
 * query to the session (own requests for patients, own assignments for
 * collectors) - the client cannot request anyone else's pickups. Cancellation
 * requires a confirmation dialog with an optional reason; recording a failed
 * pickup requires a mandatory reason. Status transitions go through the
 * conditional status endpoint, so conflicting concurrent actions produce a
 * 409 rather than double-applying.
 */
export function MyCollectionsList({ mode }: MyCollectionsListProps) {
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
  const { state, refresh } = useApiList<HomeCollectionSummary>(
    `/api/home-collections${query}`,
  );

  const [cancelTarget, setCancelTarget] =
    React.useState<HomeCollectionSummary | null>(null);
  const [cancelling, setCancelling] = React.useState(false);
  const [cancelError, setCancelError] = React.useState<string | null>(null);
  const [failureTarget, setFailureTarget] =
    React.useState<HomeCollectionSummary | null>(null);
  const [failing, setFailing] = React.useState(false);
  const [failureError, setFailureError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [advancingId, setAdvancingId] = React.useState<string | null>(null);

  const [prevServedPage, setPrevServedPage] = React.useState(state.meta.page);
  if (state.meta.page !== prevServedPage) {
    setPrevServedPage(state.meta.page);
    if (state.meta.total > 0 && state.meta.page !== page) {
      setPage(state.meta.page);
    }
  }

  function openCancel(collection: HomeCollectionSummary) {
    setActionError(null);
    setCancelError(null);
    setCancelTarget(collection);
  }

  async function handleCancel(reason: string) {
    if (!cancelTarget || cancelling) return;
    setCancelling(true);
    setCancelError(null);
    setActionError(null);

    try {
      await apiSend<ItemResponse<HomeCollectionDetail>>(
        `/api/home-collections/${cancelTarget.id}/cancel`,
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
          setActionError(error.message);
          setCancelTarget(null);
          refresh();
        }
      } else {
        setActionError("Unable to cancel the collection. Please try again.");
        setCancelTarget(null);
      }
    } finally {
      setCancelling(false);
    }
  }

  async function advanceStatus(
    collection: HomeCollectionSummary,
    target:
      | "COLLECTOR_ACCEPTED"
      | "COLLECTOR_EN_ROUTE"
      | "ARRIVED",
  ) {
    if (advancingId) return;
    setAdvancingId(collection.id);
    setActionError(null);
    try {
      await apiSend<ItemResponse<HomeCollectionDetail>>(
        `/api/home-collections/${collection.id}/status`,
        "PATCH",
        { status: target },
      );
      refresh();
    } catch (error) {
      setActionError(
        error instanceof ApiRequestError
          ? error.message
          : "Unable to update the collection. Please try again.",
      );
      refresh();
    } finally {
      setAdvancingId(null);
    }
  }

  async function handleFailure(reason: string) {
    if (!failureTarget || failing) return;
    setFailing(true);
    setFailureError(null);
    setActionError(null);
    try {
      await apiSend<ItemResponse<HomeCollectionDetail>>(
        `/api/home-collections/${failureTarget.id}/status`,
        "PATCH",
        { status: "FAILED", failureReason: reason },
      );
      setFailureTarget(null);
      refresh();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        const fieldIssues: FieldErrors = issuesToErrors(error.issues);
        if (error.status === 400 && fieldIssues.failureReason) {
          setFailureError(fieldIssues.failureReason);
        } else {
          setActionError(error.message);
          setFailureTarget(null);
          refresh();
        }
      } else {
        setActionError("Unable to record the failure. Please try again.");
        setFailureTarget(null);
      }
    } finally {
      setFailing(false);
    }
  }

  const { data, meta, loading, error } = state;
  const hasFilters = applied.length > 0 || status !== "all";
  const emptyTitle = hasFilters
    ? "No collections match your filters"
    : mode === "patient"
      ? "No collection requests yet"
      : "No pickups assigned";
  const emptyDescription = hasFilters
    ? "Try adjusting the search or status filter."
    : mode === "patient"
      ? "Request a home sample pickup to see it here."
      : "Assigned pickups will appear here once the laboratory assigns them to you.";

  const isCollector = mode === "collector";

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input
              label="Search collections"
              name="collection-search"
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
                  <TableHead>Collection</TableHead>
                  <TableHead>Date & time</TableHead>
                  <TableHead>Laboratory</TableHead>
                  {!isCollector ? <TableHead>Collector</TableHead> : null}
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
                      <TableCell colSpan={isCollector ? 7 : 8}>
                        <div className="skeleton h-4 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : data && data.length > 0 ? (
                  data.map((collection) => {
                    const badge = collectionStatusBadge(collection.status);
                    const cancellable =
                      collection.status === "PENDING" ||
                      collection.status === "CONFIRMED" ||
                      collection.status === "ASSIGNED" ||
                      collection.status === "COLLECTOR_ACCEPTED";
                    const nextAction = collectorNextAction(collection.status);
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
                        {!isCollector ? (
                          <TableCell className="max-w-32 truncate">
                            {collection.collector?.name ?? "—"}
                          </TableCell>
                        ) : null}
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
                            {isCollector && nextAction ? (
                              <Button
                                variant="outline"
                                size="sm"
                                loading={advancingId === collection.id}
                                onClick={() =>
                                  void advanceStatus(collection, nextAction)
                                }
                              >
                                {collectorActionLabel(nextAction)}
                              </Button>
                            ) : null}
                            {isCollector &&
                            (collection.status === "COLLECTOR_ACCEPTED" ||
                              collection.status === "COLLECTOR_EN_ROUTE" ||
                              collection.status === "ARRIVED") ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setFailureError(null);
                                  setFailureTarget(collection);
                                }}
                              >
                                Mark failed
                              </Button>
                            ) : null}
                            {!isCollector && cancellable ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openCancel(collection)}
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
                    <TableCell colSpan={isCollector ? 7 : 8}>
                      <EmptyState
                        icon={IconHome}
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
              {data.map((collection) => {
                const badge = collectionStatusBadge(collection.status);
                const cancellable =
                  collection.status === "PENDING" ||
                  collection.status === "CONFIRMED" ||
                  collection.status === "ASSIGNED" ||
                  collection.status === "COLLECTOR_ACCEPTED";
                const nextAction = collectorNextAction(collection.status);
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
                      {collection.laboratory?.name ?? "Laboratory"}
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
                      {isCollector && nextAction ? (
                        <Button
                          size="sm"
                          loading={advancingId === collection.id}
                          onClick={() =>
                            void advanceStatus(collection, nextAction)
                          }
                        >
                          {collectorActionLabel(nextAction)}
                        </Button>
                      ) : null}
                      {isCollector &&
                      (collection.status === "COLLECTOR_ACCEPTED" ||
                        collection.status === "COLLECTOR_EN_ROUTE" ||
                        collection.status === "ARRIVED") ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setFailureError(null);
                            setFailureTarget(collection);
                          }}
                        >
                          Mark failed
                        </Button>
                      ) : null}
                      {!isCollector && cancellable ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openCancel(collection)}
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
                icon={IconHome}
                title={emptyTitle}
                description={emptyDescription}
              />
            </div>
          )}
        </div>

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
      </Card>

      <CollectionCancelDialog
        open={cancelTarget !== null}
        collectionCode={cancelTarget?.collectionCode ?? ""}
        loading={cancelling}
        error={cancelError}
        onCancel={() => setCancelTarget(null)}
        onConfirm={(reason) => void handleCancel(reason)}
      />

      <CollectionFailureDialog
        open={failureTarget !== null}
        collectionCode={failureTarget?.collectionCode ?? ""}
        loading={failing}
        error={failureError}
        onClose={() => setFailureTarget(null)}
        onConfirm={(reason) => void handleFailure(reason)}
      />
    </div>
  );
}

/** Next progressive pickup action for a collector, or null when none applies. */
function collectorNextAction(
  status: string,
):
  | "COLLECTOR_ACCEPTED"
  | "COLLECTOR_EN_ROUTE"
  | "ARRIVED"
  | null {
  switch (status) {
    case "ASSIGNED":
      return "COLLECTOR_ACCEPTED";
    case "COLLECTOR_ACCEPTED":
      return "COLLECTOR_EN_ROUTE";
    case "COLLECTOR_EN_ROUTE":
      return "ARRIVED";
    // COLLECTED is intentionally absent: completion happens only through
    // the OTP verification panel on the detail page.
    default:
      return null;
  }
}

function collectorActionLabel(
  action: "COLLECTOR_ACCEPTED" | "COLLECTOR_EN_ROUTE" | "ARRIVED",
): string {
  switch (action) {
    case "COLLECTOR_ACCEPTED":
      return "Accept assignment";
    case "COLLECTOR_EN_ROUTE":
      return "Start route";
    case "ARRIVED":
      return "Mark arrived";
  }
}
