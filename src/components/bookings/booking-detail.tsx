"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  IconAlertTriangle,
  IconArrowRight,
  IconCalendarCheck,
  IconCheckCircle,
  IconShieldCheck,
  IconTrash,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CANCELLATION_CUTOFF_HOURS,
  bookingStatusLabel,
  canCancelAnyBooking,
  canWriteBookingStatus,
} from "@/config/lab-bookings";
import { ROLES } from "@/config/roles";
import { apiGet, apiSend, ApiRequestError } from "@/lib/api/client";
import { BookingInvoicePanel } from "@/components/billing/booking-invoice-panel";
import type { ItemResponse } from "@/types/api";
import type { LabBookingDetail as LabBookingDetailDto } from "@/types/lab-booking";
import type { SafeUser } from "@/types/auth";
import { CancelDialog } from "./cancel-dialog";
import { ConfirmDialog } from "./confirm-dialog";
import { BookingRejectDialog } from "./reject-dialog";
import {
  formatDateLabel,
  formatDateTime,
  formatPrice,
  statusBadge,
} from "./shared";

export interface BookingDetailProps {
  bookingId: string;
  user: SafeUser;
}

/**
 * Authorised booking detail: reference, laboratory, schedule, booked test
 * snapshots, price breakdown, status and cancellation information.
 *
 * Cancel / approve / reject / complete controls are shown only when the
 * viewer's role and the booking status make the action plausible - the API
 * enforces the real policy regardless. The review decision (who, when, why)
 * and the audit timeline are shown to the owner and operational viewers. On a
 * 404 (someone else's booking) the page shows a neutral not-found state
 * rather than confirming the reference exists.
 */
export function BookingDetail({ bookingId, user }: BookingDetailProps) {
  const router = useRouter();
  const [payload, setPayload] = React.useState<{
    data: LabBookingDetailDto | null;
    error: string | null;
    notFound: boolean;
  } | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelling, setCancelling] = React.useState(false);
  const [cancelError, setCancelError] = React.useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [rejecting, setRejecting] = React.useState(false);
  const [rejectError, setRejectError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [statusLoading, setStatusLoading] = React.useState(false);
  const [statusTarget, setStatusTarget] = React.useState<
    "CONFIRMED" | "COMPLETED" | null
  >(null);

  React.useEffect(() => {
    let cancelled = false;
    apiGet<ItemResponse<LabBookingDetailDto>>(
      `/api/lab-bookings/${bookingId}`,
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
                : "Unable to load the booking.",
            notFound: false,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bookingId, refreshKey]);

  const booking = payload?.data ?? null;

  const isOwner =
    booking !== null &&
    user.role === ROLES.PATIENT &&
    booking.patient?.id === user.id;
  const mayCancel =
    booking !== null &&
    (isOwner || canCancelAnyBooking(user.role)) &&
    (booking.status === "PENDING" || booking.status === "CONFIRMED");
  const mayWriteStatus =
    booking !== null && canWriteBookingStatus(user.role);

  function refresh() {
    setRefreshKey((value) => value + 1);
  }

  async function handleCancel(reason: string) {
    if (!booking || cancelling) return;
    setCancelling(true);
    setCancelError(null);

    try {
      await apiSend<ItemResponse<LabBookingDetailDto>>(
        `/api/lab-bookings/${booking.id}/cancel`,
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
        setCancelError("Unable to cancel the booking. Please try again.");
      }
    } finally {
      setCancelling(false);
    }
  }

  async function handleReject(reason: string) {
    if (!booking || rejecting) return;
    setRejecting(true);
    setRejectError(null);

    try {
      await apiSend<ItemResponse<LabBookingDetailDto>>(
        `/api/lab-bookings/${booking.id}/reject`,
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

  async function handleStatus(next: "CONFIRMED" | "COMPLETED") {
    if (!booking || statusLoading) return;
    setStatusLoading(true);
    setActionError(null);

    try {
      await apiSend<ItemResponse<LabBookingDetailDto>>(
        `/api/lab-bookings/${booking.id}/status`,
        "PATCH",
        { status: next },
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

  if (payload === null || (payload.data === null && !payload.notFound && !payload.error)) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading booking">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (payload.notFound) {
    return (
      <Card>
        <CardContent>
          <ErrorState
            title="Booking not found"
            description="This booking does not exist or you do not have permission to view it."
            onRetry={() => router.push("/dashboard")}
            retryLabel="Back to dashboard"
          />
        </CardContent>
      </Card>
    );
  }

  if (payload.error || !booking) {
    return (
      <Card>
        <CardContent>
          <ErrorState
            title="Unable to load the booking"
            description={payload.error ?? "Please try again."}
            onRetry={refresh}
          />
        </CardContent>
      </Card>
    );
  }

  const badge = statusBadge(booking.status);

  return (
    <div className="flex flex-col gap-4">
      {actionError ? (
        <p
          role="alert"
          className="rounded-control border border-danger-line bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
        >
          {actionError}
        </p>
      ) : null}

      {/* Header card */}
      <Card>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
                Booking reference
              </p>
              <p className="mt-1 font-mono text-xl font-semibold tracking-tight text-ink">
                {booking.bookingCode}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant={badge.variant} dot>
                  {badge.label}
                </Badge>
                <span className="text-sm text-ink-muted">
                  {booking.laboratory?.name ?? "Laboratory"}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {mayCancel ? (
                <Button
                  variant="danger"
                  onClick={() => {
                    setCancelError(null);
                    setActionError(null);
                    setCancelOpen(true);
                  }}
                >
                  <IconTrash className="size-4" />
                  Cancel booking
                </Button>
              ) : null}
              {mayWriteStatus && booking.status === "PENDING" ? (
                <>
                  <Button
                    loading={statusLoading}
                    onClick={() => setStatusTarget("CONFIRMED")}
                  >
                    <IconCheckCircle className="size-4" />
                    Approve request
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      setRejectError(null);
                      setActionError(null);
                      setRejectOpen(true);
                    }}
                  >
                    <IconAlertTriangle className="size-4" />
                    Reject request
                  </Button>
                </>
              ) : null}
              {mayWriteStatus && booking.status === "CONFIRMED" ? (
                <Button onClick={() => setStatusTarget("COMPLETED")}>
                  <IconCheckCircle className="size-4" />
                  Mark completed
                </Button>
              ) : null}
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 border-t border-border pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-ink-subtle">Scheduled date</dt>
              <dd className="mt-0.5 font-medium text-ink">
                {formatDateLabel(booking.bookingDate)}
              </dd>
            </div>
            <div>
              <dt className="text-ink-subtle">Time slot</dt>
              <dd className="mt-0.5 font-medium text-ink">
                {booking.timeSlot} <span className="text-ink-muted">({booking.timezone})</span>
              </dd>
            </div>
            <div>
              <dt className="text-ink-subtle">Created</dt>
              <dd className="mt-0.5 font-medium text-ink">
                {formatDateTime(booking.createdAt)}
              </dd>
            </div>
            <div>
              <dt className="text-ink-subtle">Total</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-ink">
                {formatPrice(booking.totalAmount)}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Patient + contact */}
      <Card>
        <CardHeader>
          <CardTitle>Patient & contact</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <p className="text-ink-subtle">Patient</p>
              <p className="mt-0.5 font-medium text-ink">
                {booking.patient?.name ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-ink-subtle">Phone</p>
              <p className="mt-0.5 font-medium text-ink">
                {booking.contact.phone ?? "—"}
              </p>
            </div>
            <div>
              <p className="text-ink-subtle">Email</p>
              <p className="mt-0.5 break-all font-medium text-ink">
                {booking.contact.email ?? "—"}
              </p>
            </div>
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-ink-subtle">
            <IconShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Contact details are a snapshot taken when the booking was made.
          </p>
        </CardContent>
      </Card>

      {/* Review decision (lab-manager review queue) */}
      {booking.reviewedAt || booking.rejectionReason ? (
        <Card>
          <CardHeader>
            <CardTitle>Review</CardTitle>
            <p className="text-sm text-ink-muted">
              Decision recorded from the Collection requests queue.
            </p>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-ink-subtle">Reviewed by</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {booking.reviewedBy?.name ?? "—"}
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle">Reviewed at</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {booking.reviewedAt ? formatDateTime(booking.reviewedAt) : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle">Decision</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {bookingStatusLabel(booking.status)}
                </dd>
              </div>
              {booking.rejectionReason ? (
                <div className="sm:col-span-3">
                  <dt className="text-ink-subtle">Rejection reason</dt>
                  <dd className="mt-0.5 font-medium text-danger">
                    {booking.rejectionReason}
                  </dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>
      ) : null}

      {/* Test snapshot + price breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Booked tests</CardTitle>
          <p className="text-sm text-ink-muted">
            Names and prices as recorded at booking time.
          </p>
        </CardHeader>
        <CardContent>
          <div className="rounded-control border border-border">
            <ul className="divide-y divide-border">
              {booking.items.map((item) => (
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
                <p className="text-sm font-semibold text-ink">Total</p>
                <p className="text-sm font-semibold tabular-nums text-ink">
                  {formatPrice(booking.totalAmount)}
                </p>
              </li>
            </ul>
          </div>

          {booking.notes ? (
            <div className="mt-4">
              <p className="text-ink-subtle text-xs font-semibold uppercase tracking-wide">
                Notes
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                {booking.notes}
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <BookingInvoicePanel
        bookingId={booking.id}
        bookingStatus={booking.status}
        user={user}
      />

      {/* Audit history */}
      {booking.history && booking.history.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {booking.history.map((entry) => (
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
                        {bookingStatusLabel(entry.previousStatus)} →{" "}
                        {bookingStatusLabel(entry.newStatus)}
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

      {/* Cancellation info */}
      {booking.status === "CANCELLED" ? (
        <Card>
          <CardHeader>
            <CardTitle>Cancellation</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-ink-subtle">Cancelled at</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {booking.cancelledAt
                    ? formatDateTime(booking.cancelledAt)
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="text-ink-subtle">Reason</dt>
                <dd className="mt-0.5 font-medium text-ink">
                  {booking.cancellationReason ?? "No reason provided"}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => router.back()}>
          Back
        </Button>
        <Button
          variant="ghost"
          onClick={() => router.push(isOwner ? "/my-bookings" : "/lab-bookings")}
        >
          {isOwner ? "My bookings" : "All bookings"}
          <IconArrowRight className="size-4" />
        </Button>
        {booking.status === "PENDING" || booking.status === "CONFIRMED" ? (
          <span className="inline-flex items-center gap-1.5 self-center text-xs text-ink-subtle">
            <IconCalendarCheck className="size-3.5" aria-hidden="true" />
            Free cancellation up to {CANCELLATION_CUTOFF_HOURS} hour(s) before
            the slot.
          </span>
        ) : null}
      </div>

      <CancelDialog
        open={cancelOpen}
        bookingCode={booking.bookingCode}
        loading={cancelling}
        error={cancelError}
        onCancel={() => setCancelOpen(false)}
        onConfirm={(reason) => void handleCancel(reason)}
      />

      <ConfirmDialog
        open={statusTarget !== null}
        title={statusTarget === "COMPLETED" ? "Mark as completed?" : "Approve request?"}
        description={
          statusTarget === "COMPLETED"
            ? `Booking ${booking.bookingCode} will be marked completed.`
            : `Booking ${booking.bookingCode} will be approved and the appointment confirmed for the patient.`
        }
        confirmLabel={statusTarget === "COMPLETED" ? "Complete" : "Approve"}
        cancelLabel="Not now"
        tone="primary"
        loading={statusLoading}
        onCancel={() => setStatusTarget(null)}
        onConfirm={() => {
          if (statusTarget) void handleStatus(statusTarget);
        }}
      />

      <BookingRejectDialog
        open={rejectOpen}
        bookingCode={booking.bookingCode}
        loading={rejecting}
        error={rejectError}
        onClose={() => setRejectOpen(false)}
        onConfirm={(reason) => void handleReject(reason)}
      />
    </div>
  );
}
