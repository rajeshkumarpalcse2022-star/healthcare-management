"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  IconCalendarCheck,
  IconEye,
  IconPencil,
  IconSearch,
  IconStethoscope,
  IconTrash,
  IconVideo,
} from "@/components/icons";
import { EntityAvatar } from "@/components/shared/entity-avatar";
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
  AppointmentDetail,
  AppointmentSummary,
} from "@/types/appointment";
import { Pagination } from "../bookings/pagination";
import { AppointmentCancelDialog } from "./appointment-dialogs";
import { RescheduleDialog } from "./reschedule-dialog";
import {
  APPOINTMENT_STATUS_OPTIONS,
  APPOINTMENT_TYPE_OPTIONS,
  appointmentStatusBadge,
  appointmentTypeBadge,
  buildQueryString,
  formatDateLabel,
  formatDateTime,
  isCancellableAppointment,
  issuesToErrors,
  type FieldErrors,
} from "./shared";

/**
 * Authenticated patient's appointment history.
 *
 * Every row comes from `GET /api/appointments`, which hard-scopes the query
 * to the session's own patient - the client cannot request anyone else's
 * appointments. Cancelling and rescheduling are only offered while the
 * status is cancellable, and both endpoints re-check ownership on the
 * server. Completed appointments link to their released consultation record
 * through the detail page.
 */
export function MyAppointmentsList() {
  const router = useRouter();
  const { search, setSearch, applied } = useDebouncedSearch();
  const [status, setStatus] = React.useState("all");
  const [type, setType] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(10);

  const query = buildQueryString({
    search: applied || undefined,
    status,
    type,
    page,
    limit,
  });
  const { state, refresh } = useApiList<AppointmentSummary>(
    `/api/appointments${query}`,
  );

  const [cancelTarget, setCancelTarget] =
    React.useState<AppointmentSummary | null>(null);
  const [rescheduleTarget, setRescheduleTarget] =
    React.useState<AppointmentSummary | null>(null);
  const [dialogError, setDialogError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const [prevServedPage, setPrevServedPage] = React.useState(state.meta.page);
  if (state.meta.page !== prevServedPage) {
    setPrevServedPage(state.meta.page);
    if (state.meta.total > 0 && state.meta.page !== page) {
      setPage(state.meta.page);
    }
  }

  function closeDialogs() {
    setCancelTarget(null);
    setRescheduleTarget(null);
    setDialogError(null);
  }

  async function runAction(request: Promise<unknown>) {
    setBusy(true);
    setDialogError(null);
    setActionError(null);
    try {
      await request;
      closeDialogs();
      refresh();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        const fieldIssues: FieldErrors = issuesToErrors(error.issues);
        const fieldError =
          fieldIssues.reason ??
          fieldIssues.timeSlot ??
          fieldIssues.appointmentDate;
        if (fieldError) {
          setDialogError(fieldError);
        } else {
          // Policy rejections (slot taken, already started, ...) surface as
          // a banner; the dialog closes and the list refreshes.
          setActionError(error.message);
          closeDialogs();
          refresh();
        }
      } else {
        setActionError("Unable to update the appointment. Please try again.");
        closeDialogs();
      }
    } finally {
      setBusy(false);
    }
  }

  const { data, meta, loading, error } = state;
  const hasFilters = applied.length > 0 || status !== "all" || type !== "all";
  const emptyTitle = hasFilters
    ? "No appointments match your filters"
    : "No appointments yet";
  const emptyDescription = hasFilters
    ? "Try adjusting the search or status filter."
    : "Find a doctor and book a consultation to see it here.";

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input
              label="Search appointments"
              name="appointment-search"
              icon={<IconSearch className="size-4" />}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Appointment reference"
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
              options={APPOINTMENT_STATUS_OPTIONS}
            />
            <Select
              aria-label="Filter by type"
              label="Type"
              value={type}
              onChange={(event) => {
                setType(event.target.value);
                setPage(1);
              }}
              options={APPOINTMENT_TYPE_OPTIONS}
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
                  <TableHead>Appointment</TableHead>
                  <TableHead>Date & time</TableHead>
                  <TableHead>Doctor</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && data === null ? (
                  Array.from({ length: 5 }, (_, index) => (
                    <TableRow key={`skeleton-${index}`}>
                      <TableCell colSpan={7}>
                        <div className="skeleton h-4 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : data && data.length > 0 ? (
                  data.map((appointment) => {
                    const badge = appointmentStatusBadge(appointment.status);
                    const typeBadge = appointmentTypeBadge(
                      appointment.appointmentType,
                    );
                    const cancellable = isCancellableAppointment(
                      appointment.status,
                    );
                    return (
                      <TableRow key={appointment.id}>
                        <TableCell className="font-mono text-xs font-medium text-ink">
                          {appointment.appointmentCode}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="min-w-0">
                            <p className="text-ink">
                              {formatDateLabel(appointment.date)}
                            </p>
                            <p className="text-xs text-ink-muted">
                              {appointment.timeSlot} - {appointment.endTime}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-40">
                          <div className="flex items-center gap-2">
                            <EntityAvatar
                              src={appointment.doctor?.profileImageUrl}
                              alt={appointment.doctor?.name ?? "Doctor"}
                              fallback={<IconStethoscope className="size-3.5" />}
                              className="size-7"
                              sizes="28px"
                            />
                            <p className="truncate text-ink">
                              {appointment.doctor?.name ?? "�?"}
                            </p>
                          </div>
                          {appointment.reason ? (
                            <p
                              className="mt-0.5 truncate text-xs text-ink-muted"
                              title={appointment.reason}
                            >
                              {appointment.reason}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Badge variant={typeBadge.variant} size="sm">
                            {typeBadge.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={badge.variant} dot>
                            {badge.label}
                          </Badge>
                          {appointment.status === "CONFIRMED" ? (
                            <p className="mt-1 text-xs text-ink-subtle">
                              Accepted by your doctor
                            </p>
                          ) : appointment.status === "REJECTED" &&
                            appointment.rejectionReason ? (
                            <p
                              className="mt-1 max-w-40 line-clamp-2 text-xs text-danger"
                              title={appointment.rejectionReason}
                            >
                              {appointment.rejectionReason}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-ink-muted">
                          {formatDateTime(appointment.createdAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                router.push(`/appointments/${appointment.id}`)
                              }
                            >
                              <IconEye className="size-4" />
                              View
                            </Button>
                            {cancellable ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => {
                                    setActionError(null);
                                    setDialogError(null);
                                    setRescheduleTarget(appointment);
                                  }}
                                >
                                  <IconPencil className="size-4" />
                                  Reschedule
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => {
                                    setActionError(null);
                                    setDialogError(null);
                                    setCancelTarget(appointment);
                                  }}
                                >
                                  <IconTrash className="size-4" />
                                  Cancel
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <EmptyState
                        icon={IconCalendarCheck}
                        title={emptyTitle}
                        description={emptyDescription}
                        action={
                          hasFilters ? undefined : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => router.push("/find-a-doctor")}
                            >
                              <IconStethoscope className="size-4" />
                              Find a doctor
                            </Button>
                          )
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
              {data.map((appointment) => {
                const badge = appointmentStatusBadge(appointment.status);
                const typeBadge = appointmentTypeBadge(
                  appointment.appointmentType,
                );
                const cancellable = isCancellableAppointment(
                  appointment.status,
                );
                const meetingLink = appointment.meetingLink;
                return (
                  <li key={appointment.id} className="p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm font-semibold text-ink">
                          {appointment.appointmentCode}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-ink-muted">
                          {formatDateLabel(appointment.date)} ·{" "}
                          {appointment.timeSlot}
                        </p>
                      </div>
                      <Badge variant={badge.variant} dot>
                        {badge.label}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant={typeBadge.variant} size="sm">
                        {typeBadge.label}
                      </Badge>
                    </div>
                    <div className="mt-2 flex min-w-0 items-center gap-2">
                      <EntityAvatar
                        src={appointment.doctor?.profileImageUrl}
                        alt={appointment.doctor?.name ?? "Doctor"}
                        fallback={<IconStethoscope className="size-3.5" />}
                        className="size-7"
                        sizes="28px"
                      />
                      <p className="truncate text-sm text-ink-muted">
                        {appointment.doctor?.name ?? "Doctor"}
                      </p>
                    </div>
                    {appointment.reason ? (
                      <p
                        className="mt-1 line-clamp-2 text-sm text-ink"
                        title={appointment.reason}
                      >
                        <span className="text-ink-subtle">Problem: </span>
                        {appointment.reason}
                      </p>
                    ) : null}
                    {appointment.status === "CONFIRMED" ? (
                      <p className="mt-2 rounded-control border border-success-line bg-success-soft px-3 py-2 text-xs text-success-strong">
                        Accepted by your doctor
                      </p>
                    ) : appointment.status === "REJECTED" &&
                      appointment.rejectionReason ? (
                      <p className="mt-2 rounded-control border border-danger-line bg-danger-soft px-3 py-2 text-xs text-danger">
                        <span className="font-medium">
                          Rejection reason:{" "}
                        </span>
                        {appointment.rejectionReason}
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          router.push(`/appointments/${appointment.id}`)
                        }
                      >
                        <IconEye className="size-4" />
                        View
                      </Button>
                      {meetingLink &&
                      (appointment.status === "CONFIRMED" ||
                        appointment.status === "IN_PROGRESS") ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            window.open(
                              meetingLink,
                              "_blank",
                              "noopener,noreferrer",
                            )
                          }
                        >
                          <IconVideo className="size-4" />
                          Join
                        </Button>
                      ) : null}
                      {cancellable ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              setActionError(null);
                              setDialogError(null);
                              setRescheduleTarget(appointment);
                            }}
                          >
                            <IconPencil className="size-4" />
                            Reschedule
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              setActionError(null);
                              setDialogError(null);
                              setCancelTarget(appointment);
                            }}
                          >
                            <IconTrash className="size-4" />
                            Cancel
                          </Button>
                        </>
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
                action={
                  hasFilters ? undefined : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => router.push("/find-a-doctor")}
                    >
                      <IconStethoscope className="size-4" />
                      Find a doctor
                    </Button>
                  )
                }
              />
            </div>
          )}
        </div>

        {error ? (
          <div className="p-4 sm:p-5">
            <ErrorState
              title="Unable to load your appointments"
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

      <AppointmentCancelDialog
        open={cancelTarget !== null}
        appointmentCode={cancelTarget?.appointmentCode ?? ""}
        loading={busy}
        error={dialogError}
        onCancel={closeDialogs}
        onConfirm={(reason) =>
          cancelTarget
            ? void runAction(
                apiSend<ItemResponse<AppointmentDetail>>(
                  `/api/appointments/${cancelTarget.id}/cancel`,
                  "PATCH",
                  { reason: reason.length > 0 ? reason : null },
                ),
              )
            : undefined
        }
      />

      {rescheduleTarget ? (
        <RescheduleDialog
          open
          appointment={rescheduleTarget}
          loading={busy}
          error={dialogError}
          onClose={closeDialogs}
          onConfirm={(date, timeSlot) =>
            void runAction(
              apiSend<ItemResponse<AppointmentDetail>>(
                `/api/appointments/${rescheduleTarget.id}/reschedule`,
                "PATCH",
                { appointmentDate: date, timeSlot },
              ),
            )
          }
        />
      ) : null}
    </div>
  );
}
