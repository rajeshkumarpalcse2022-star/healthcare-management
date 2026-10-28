"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  IconAlertTriangle,
  IconArrowRight,
  IconCheckCircle,
  IconHome,
  IconShieldCheck,
  IconTrash,
  IconUserCheck,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  collectionAdvanceTargets,
  collectionStatusLabel,
} from "@/config/home-collection";
import type { CollectionStatus } from "@/config/home-collection";
import { apiGet, apiSend, ApiRequestError } from "@/lib/api/client";
import type { ItemResponse } from "@/types/api";
import type {
  HomeCollectionDetail as HomeCollectionDetailDto,
} from "@/types/home-collection";
import type { SafeUser } from "@/types/auth";
import { CollectionCancelDialog } from "./cancel-dialog";
import { CollectorAssignDialog } from "./assign-dialog";
import { CollectionFailureDialog } from "./failure-dialog";
import { CollectionRejectDialog } from "./reject-dialog";
import { CollectorOtpPanel } from "./collector-otp-panel";
import { PatientOtpPanel } from "./patient-otp-panel";
import {
  collectionStatusBadge,
  formatDateLabel,
  formatDateTime,
  formatPrice,
} from "./shared";

export interface CollectionDetailProps {
  collectionId: string;
  user: SafeUser;
}

/**
 * Authorised collection detail: reference, laboratory, schedule, pickup
 * address (detail responses only), test snapshots, estimated total, linked
 * booking, audit history and lifecycle actions.
 *
 * Cancel / assign / confirm / advance / fail controls are shown only when
 * the server-derived viewer capabilities and the current status make the
 * action plausible - the API enforces the real policy regardless. On a 404
 * (someone else's collection) the page shows a neutral not-found state
 * rather than confirming the reference exists.
 */
export function CollectionDetail({
  collectionId,
  user,
}: CollectionDetailProps) {
  const router = useRouter();
  const [payload, setPayload] = React.useState<{
    data: HomeCollectionDetailDto | null;
    error: string | null;
    notFound: boolean;
  } | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [cancelError, setCancelError] = React.useState<string | null>(null);
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [assigning, setAssigning] = React.useState(false);
  const [assignError, setAssignError] = React.useState<string | null>(null);
  const [failureOpen, setFailureOpen] = React.useState(false);
  const [failing, setFailing] = React.useState(false);
  const [failureError, setFailureError] = React.useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);
  const [rejectError, setRejectError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [statusLoading, setStatusLoading] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    apiGet<ItemResponse<HomeCollectionDetailDto>>(
      `/api/home-collections/${collectionId}`,
    )
      .then((result) => {
        if (!cancelled) {
          setPayload({ data: result.data, error: null, notFound: false });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiRequestError && error.status === 404) {
          setPayload({ data: null, error: null, notFound: true });
        } else {
          setPayload({
            data: null,
            error:
              error instanceof ApiRequestError
                ? error.message
                : "Unable to load the collection.",
            notFound: false,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [collectionId, refreshKey]);

  const collection = payload?.data ?? null;
  const caps = collection?.viewerCapabilities;
  const total = collection
    ? collection.items.reduce((sum, item) => sum + item.price, 0)
    : 0;

  function refresh() {
    setRefreshKey((value) => value + 1);
  }

  async function handleCancel(reason: string) {
    if (!collection || cancelling) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await apiSend<ItemResponse<HomeCollectionDetailDto>>(
        `/api/home-collections/${collection.id}/cancel`,
        "PATCH",
        { reason: reason.length > 0 ? reason : null },
      );
      setCancelOpen(false);
      refresh();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.status === 400 && error.issues?.length) {
          setCancelError(error.issues[0].message);
        } else {
          setActionError(error.message);
          setCancelOpen(false);
          refresh();
        }
      } else {
        setCancelError("Unable to cancel the collection. Please try again.");
      }
    } finally {
      setCancelling(false);
    }
  }

  async function handleAssign(collectorId: string) {
    if (!collection || assigning) return;
    setAssigning(true);
    setAssignError(null);
    try {
      await apiSend<ItemResponse<HomeCollectionDetailDto>>(
        `/api/home-collections/${collection.id}/assign`,
        "PATCH",
        { collectorId },
      );
      setAssignOpen(false);
      refresh();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.status === 400 && error.issues?.length) {
          setAssignError(error.issues[0].message);
        } else {
          setActionError(error.message);
          setAssignOpen(false);
        }
      } else {
        setAssignError("Unable to assign the collector. Please try again.");
      }
    } finally {
      setAssigning(false);
    }
  }

  async function handleReject(reason: string) {
    if (!collection || rejecting) return;
    setRejecting(true);
    setRejectError(null);
    try {
      await apiSend<ItemResponse<HomeCollectionDetailDto>>(
        `/api/home-collections/${collection.id}/reject`,
        "PATCH",
        { reason },
      );
      setRejectOpen(false);
      refresh();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.status === 400 && error.issues?.length) {
          setRejectError(error.issues[0].message);
        } else {
          setActionError(error.message);
          setRejectOpen(false);
          refresh();
        }
      } else {
        setRejectError("Unable to reject the request. Please try again.");
      }
    } finally {
      setRejecting(false);
    }
  }

  async function handleFailure(reason: string) {
    if (!collection || failing) return;
    setFailing(true);
    setFailureError(null);
    try {
      await apiSend<ItemResponse<HomeCollectionDetailDto>>(
        `/api/home-collections/${collection.id}/status`,
        "PATCH",
        { status: "FAILED", failureReason: reason },
      );
      setFailureOpen(false);
      refresh();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        if (error.status === 400 && error.issues?.length) {
          setFailureError(error.issues[0].message);
        } else {
          setActionError(error.message);
          setFailureOpen(false);
          refresh();
        }
      } else {
        setFailureError("Unable to record the failure. Please try again.");
      }
    } finally {
      setFailing(false);
    }
  }

  async function advanceStatus(target: CollectionStatus) {
    if (!collection || statusLoading) return;
    setStatusLoading(true);
    setActionError(null);
    try {
      await apiSend<ItemResponse<HomeCollectionDetailDto>>(
        `/api/home-collections/${collection.id}/status`,
        "PATCH",
        { status: target },
      );
      refresh();
    } catch (error) {
      setActionError(
        error instanceof ApiRequestError
          ? error.message
          : "Unable to update the collection.",
      );
      refresh();
    } finally {
      setStatusLoading(false);
    }
  }

  if (payload?.notFound) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={IconHome}
            title="Collection not found"
            description="This collection request does not exist, or you do not have permission to view it."
            action={
              <Button variant="outline" onClick={() => router.back()}>
                Go back
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  if (payload?.error) {
    return (
      <Card>
        <CardContent>
          <ErrorState
            title="Unable to load the collection"
            description={payload.error}
            onRetry={refresh}
          />
        </CardContent>
      </Card>
    );
  }

  if (!collection) {
    return (
      <div className="space-y-4" aria-hidden="true">
        <Skeleton className="h-24 w-full rounded-card" />
        <Skeleton className="h-48 w-full rounded-card" />
        <Skeleton className="h-32 w-full rounded-card" />
      </div>
    );
  }

  const badge = collectionStatusBadge(collection.status);
  const status = collection.status as CollectionStatus;
  // Targets with dedicated actions are excluded (accept/reject/cancel/
  // failure dialogs, the assign dialog for ASSIGNED, the OTP panel for
  // COLLECTED) - only genuine progression buttons render here.
  const allowedNext = collectionAdvanceTargets(status);

  return (
    <>
      {actionError ? (
        <p
          role="alert"
          className="mb-4 rounded-control border border-danger-line bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
        >
          {actionError}
        </p>
      ) : null}

      {/* Overview */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-xs uppercase tracking-wide text-ink-muted">
                {collection.collectionCode}
              </p>
              <CardTitle className="mt-1">
                {collection.laboratory?.name ?? "Laboratory"} pickup
              </CardTitle>
              <p className="mt-1 text-sm text-ink-muted">
                {formatDateLabel(collection.scheduledDate)} at{" "}
                {collection.timeSlot} · {collection.timezone}
              </p>
            </div>
            <Badge variant={badge.variant} dot>
              {badge.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {caps?.canConfirm ||
          caps?.canReject ||
          caps?.canAssign ||
          caps?.canAdvanceStatus ||
          caps?.canRecordFailure ||
          caps?.canCancel ? (
            <div className="mb-5 flex flex-wrap gap-2">
              {caps.canConfirm ? (
                <Button
                  loading={statusLoading}
                  onClick={() => void advanceStatus("CONFIRMED")}
                >
                  <IconCheckCircle className="size-4" />
                  Accept request
                </Button>
              ) : null}
              {caps.canReject ? (
                <Button
                  variant="danger"
                  onClick={() => {
                    setRejectError(null);
                    setRejectOpen(true);
                  }}
                >
                  <IconAlertTriangle className="size-4" />
                  Reject request
                </Button>
              ) : null}
              {caps.canAssign ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setAssignError(null);
                    setAssignOpen(true);
                  }}
                >
                  <IconUserCheck className="size-4" />
                  {collection.collector ? "Reassign collector" : "Assign collector"}
                </Button>
              ) : null}
              {caps.canAdvanceStatus
                ? allowedNext.map((next) => (
                    <Button
                      key={next}
                      variant="outline"
                      loading={statusLoading}
                      onClick={() => void advanceStatus(next)}
                    >
                      {next === "COLLECTOR_ACCEPTED"
                        ? "Accept assignment"
                        : next === "COLLECTOR_EN_ROUTE"
                          ? "Mark en route"
                          : next === "ARRIVED"
                            ? "Mark arrived"
                            : collectionStatusLabel(next)}
                    </Button>
                  ))
                : null}
              {caps.canRecordFailure ? (
                <Button
                  variant="danger"
                  onClick={() => {
                    setFailureError(null);
                    setFailureOpen(true);
                  }}
                >
                  <IconAlertTriangle className="size-4" />
                  Record failed pickup
                </Button>
              ) : null}
              {caps.canCancel ? (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCancelError(null);
                    setCancelOpen(true);
                  }}
                >
                  <IconTrash className="size-4" />
                  Cancel request
                </Button>
              ) : null}
            </div>
          ) : null}

          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-ink-subtle">Patient</dt>
              <dd className="mt-0.5 font-medium text-ink">
                {collection.patient?.name ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-ink-subtle">Collector</dt>
              <dd className="mt-0.5 font-medium text-ink">
                {collection.collector
                  ? `${collection.collector.name}${collection.collector.phone ? ` · ${collection.collector.phone}` : ""}`
                  : "Not assigned"}
              </dd>
            </div>
            <div>
              <dt className="text-ink-subtle">Contact</dt>
              <dd className="mt-0.5 font-medium text-ink">
                {collection.contact.name}
                {collection.contact.phone ? (
                  <>
                    {" · "}
                    <a
                      href={`tel:${collection.contact.phone}`}
                      className="text-primary hover:underline"
                    >
                      {collection.contact.phone}
                    </a>
                  </>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-ink-subtle">Estimated total</dt>
              <dd className="mt-0.5 font-medium tabular-nums text-ink">
                {formatPrice(total)}
              </dd>
            </div>
            {collection.labBooking ? (
              <div>
                <dt className="text-ink-subtle">Linked booking</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {collection.labBooking.bookingCode} ·{" "}
                  {collection.labBooking.status}
                </dd>
              </div>
            ) : null}
            {collection.retryOf ? (
              <div>
                <dt className="text-ink-subtle">Retry of</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {collection.retryOf.collectionCode}
                </dd>
              </div>
            ) : null}
            <div className="sm:col-span-2">
              <dt className="text-ink-subtle">Pickup address</dt>
              <dd className="mt-0.5 font-medium text-ink">
                {collection.address.recipientName}, {collection.address.addressLine1}
                {collection.address.addressLine2
                  ? `, ${collection.address.addressLine2}`
                  : ""}
                {collection.address.landmark
                  ? ` · ${collection.address.landmark}`
                  : ""}
                , {collection.address.city}, {collection.address.state}{" "}
                {collection.address.pincode}
              </dd>
              {collection.address.latitude !== null &&
              collection.address.longitude !== null ? (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${collection.address.latitude},${collection.address.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <IconArrowRight className="size-3.5" aria-hidden="true" />
                  Open in Google Maps ({collection.address.latitude},{" "}
                  {collection.address.longitude})
                </a>
              ) : (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    `${collection.address.addressLine1}, ${collection.address.city}, ${collection.address.state} ${collection.address.pincode}`,
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <IconArrowRight className="size-3.5" aria-hidden="true" />
                  Open address in Google Maps
                </a>
              )}
            </div>
            {collection.address.instructions ? (
              <div className="sm:col-span-2">
                <dt className="text-ink-subtle">Address instructions</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {collection.address.instructions}
                </dd>
              </div>
            ) : null}
            {collection.collectionNotes ? (
              <div className="sm:col-span-2">
                <dt className="text-ink-subtle">Collection instructions</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {collection.collectionNotes}
                </dd>
              </div>
            ) : null}
            {collection.rejectionReason ? (
              <div className="sm:col-span-2">
                <dt className="text-ink-subtle">Rejection reason</dt>
                <dd className="mt-0.5 font-medium text-danger">
                  {collection.rejectionReason}
                </dd>
              </div>
            ) : null}
            {collection.failureReason ? (
              <div className="sm:col-span-2">
                <dt className="text-ink-subtle">Failure reason</dt>
                <dd className="mt-0.5 font-medium text-danger">
                  {collection.failureReason}
                </dd>
              </div>
            ) : null}
            {collection.cancellationReason ? (
              <div className="sm:col-span-2">
                <dt className="text-ink-subtle">Cancellation reason</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {collection.cancellationReason}
                </dd>
              </div>
            ) : null}
          </dl>

          <div className="mt-4 flex items-start gap-2.5 rounded-control border border-info-line bg-info-soft p-3.5 text-sm text-info">
            <IconShieldCheck
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <p>
              Pickup details and the contact phone are shared only with the
              laboratory team and the assigned collector.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Patient OTP recovery (owner only, active requests) */}
      {user.role === "PATIENT" &&
      collection.patient?.id === user.id &&
      status !== "REJECTED" &&
      status !== "CANCELLED" &&
      status !== "FAILED" ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Pickup OTP</CardTitle>
          </CardHeader>
          <CardContent>
            <PatientOtpPanel
              collectionId={collection.id}
              otp={collection.otp}
              onRegenerated={refresh}
            />
          </CardContent>
        </Card>
      ) : null}

      {/* Tests */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Tests</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border rounded-control border border-border">
            {collection.items.map((item) => (
              <li
                key={item.labTestId}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {item.testName}
                  </p>
                  <p className="truncate text-xs text-ink-muted">
                    {item.testCode}
                    {item.specimenType ? ` · ${item.specimenType}` : ""}
                  </p>
                  {item.preparationInstructions ? (
                    <p className="mt-0.5 truncate text-xs text-ink-subtle">
                      Prep: {item.preparationInstructions}
                    </p>
                  ) : null}
                </div>
                <p className="shrink-0 text-sm tabular-nums text-ink">
                  {formatPrice(item.price)}
                </p>
              </li>
            ))}
            <li className="flex items-center justify-between gap-3 bg-surface-muted px-4 py-3">
              <p className="text-sm font-semibold text-ink">Estimated total</p>
              <p className="text-sm font-semibold tabular-nums text-ink">
                {formatPrice(total)}
              </p>
            </li>
          </ul>
          <p className="mt-2 text-xs text-ink-subtle">
            Prices were captured from the laboratory catalogue at request time.
            No payment is recorded by this module.
          </p>
        </CardContent>
      </Card>

      {/* Audit history */}
      {collection.history && collection.history.length > 0 ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {collection.history.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-control border border-border px-3.5 py-2.5 text-sm"
                >
                  <div>
                    <p className="font-medium text-ink">{entry.eventLabel}</p>
                    {entry.reason ? (
                      <p className="mt-0.5 text-xs text-ink-muted">
                        Reason: {entry.reason}
                      </p>
                    ) : null}
                    {entry.previousStatus && entry.newStatus ? (
                      <p className="mt-0.5 text-xs text-ink-muted">
                        {collectionStatusLabel(entry.previousStatus)} →{" "}
                        {collectionStatusLabel(entry.newStatus)}
                      </p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-ink-muted">
                      {entry.actor?.name ?? "System"}
                    </p>
                    <p className="text-xs text-ink-subtle">
                      {formatDateTime(entry.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}

      {/* Collector OTP verification (assigned collector or ops, actionable status) */}
      {(status === "COLLECTOR_ACCEPTED" ||
        status === "COLLECTOR_EN_ROUTE" ||
        status === "ARRIVED") &&
      (caps?.canAdvanceStatus || user.role === "COLLECTOR") ? (
        <div className="mt-4">
          <CollectorOtpPanel
            collectionId={collection.id}
            attemptsRemaining={collection.otp?.attemptsRemaining ?? null}
            onCompleted={refresh}
          />
        </div>
      ) : null}

      <CollectionCancelDialog
        open={cancelOpen}
        collectionCode={collection.collectionCode}
        loading={cancelling}
        error={cancelError}
        onCancel={() => setCancelOpen(false)}
        onConfirm={(reason) => void handleCancel(reason)}
      />

      <CollectionRejectDialog
        open={rejectOpen}
        collectionCode={collection.collectionCode}
        loading={rejecting}
        error={rejectError}
        onClose={() => setRejectOpen(false)}
        onConfirm={(reason) => void handleReject(reason)}
      />

      <CollectorAssignDialog
        open={assignOpen}
        collectionCode={collection.collectionCode}
        currentCollectorId={collection.collector?.id ?? null}
        loading={assigning}
        error={assignError}
        onClose={() => setAssignOpen(false)}
        onConfirm={(collectorId) => void handleAssign(collectorId)}
      />

      <CollectionFailureDialog
        open={failureOpen}
        collectionCode={collection.collectionCode}
        loading={failing}
        error={failureError}
        onClose={() => setFailureOpen(false)}
        onConfirm={(reason) => void handleFailure(reason)}
      />
    </>
  );
}
