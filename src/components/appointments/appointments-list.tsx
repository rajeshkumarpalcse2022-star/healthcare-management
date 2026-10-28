"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  IconActivity,
  IconCalendarCheck,
  IconCheckCircle,
  IconEye,
  IconRefresh,
  IconSearch,
  IconStethoscope,
  IconTrash,
  IconVideo,
  IconX,
} from "@/components/icons";
import { ConfirmDialog } from "@/components/bookings/confirm-dialog";
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
import { localDateString } from "@/lib/utils/dashboard-rows";
import type { ItemResponse } from "@/types/api";
import type {
  AppointmentDetail,
  AppointmentSummary,
} from "@/types/appointment";
import { Pagination } from "../bookings/pagination";
import {
  AppointmentCancelDialog,
  AppointmentRejectDialog,
} from "./appointment-dialogs";
import {
  APPOINTMENT_STATUS_OPTIONS,
  APPOINTMENT_TRANSITION_COPY,
  APPOINTMENT_TYPE_OPTIONS,
  appointmentStatusBadge,
  appointmentTypeBadge,
  buildQueryString,
  canCompleteAppointment,
  canStartAppointment,
  formatDateLabel,
  formatDateTime,
  isCancellableAppointment,
  issuesToErrors,
  notifyAppointmentsChanged,
  type AppointmentTransitionTarget,
  type FieldErrors,
} from "./shared";

type TransitionTarget = AppointmentTransitionTarget;

export interface AppointmentsListProps {
  /**
   * `doctor` renders the treating doctor's operational actions (confirm,
   * reject, start, complete); `management` renders the administrative
   * monitoring actions (cancel any). Patients use `MyAppointmentsList`.
   */
  variant: "doctor" | "management";
  /**
   * Doctor day queue: only today's accepted appointments (confirmed or in
   * progress), ordered by booking time so the earliest request is served first.
   */
  todayQueue?: boolean;
}

/**
 * Appointment list for doctors and administrative monitors.
 *
 * Rows come from `GET /api/appointments`, which scopes the query server-side
 * (own doctor profile for doctors, full monitoring list for super admin /
 * admin) - the client only narrows within that scope. Every transition goes
 * through the dedicated endpoints so the server re-validates status, role
 * and capacity; a 409 race is surfaced as a banner and the list refreshes.
 */
export function AppointmentsList({
  variant,
  todayQueue = false,
}: AppointmentsListProps) {
  const router = useRouter();
  const { search, setSearch, applied } = useDebouncedSearch();
  const [today] = React.useState(() => localDateString());
  const [status, setStatus] = React.useState("all");
  const [type, setType] = React.useState("all");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(todayQueue ? 25 : 10);

  const query = buildQueryString({
    search: applied || undefined,
    status: todayQueue ? "ACTIVE" : status,
    type,
    dateFrom: todayQueue ? today : dateFrom || undefined,
    dateTo: todayQueue ? today : dateTo || undefined,
    sort: todayQueue ? "booked" : undefined,
    page,
    limit,
  });
  const { state, refresh } = useApiList<AppointmentSummary>(
    `/api/appointments${query}`,
  );

  const [cancelTarget, setCancelTarget] =
    React.useState<AppointmentSummary | null>(null);
  const [rejectTarget, setRejectTarget] =
    React.useState<AppointmentSummary | null>(null);
  const [transition, setTransition] = React.useState<{
    appointment: AppointmentSummary;
    to: TransitionTarget;
  } | null>(null);
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
    setRejectTarget(null);
    setTransition(null);
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
      notifyAppointmentsChanged();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        const fieldIssues: FieldErrors = issuesToErrors(error.issues);
        if (fieldIssues.reason) {
          setDialogError(fieldIssues.reason);
        } else {
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
  const hasFilters = todayQueue
    ? applied.length > 0 || type !== "all"
    : applied.length > 0 ||
      status !== "all" ||
      type !== "all" ||
      dateFrom !== "" ||
      dateTo !== "";
  const emptyTitle = hasFilters
    ? "No appointments match your filters"
    : todayQueue
      ? "No appointments left for today"
      : "No appointments yet";
  const emptyDescription = hasFilters
    ? todayQueue
      ? "Try adjusting the search or type filter."
      : "Try adjusting the search, status or date filters."
    : todayQueue
      ? "Accepted appointments for today will appear here in booking order."
      : variant === "doctor"
        ? "Confirmed and requested appointments will appear here."
        : "Patient appointment requests will appear here.";
  const serialFor = (index: number) =>
    (meta.page - 1) * meta.limit + index + 1;
  const columnCount = (variant === "management" ? 8 : 7) + (todayQueue ? 1 : 0);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <div
            className={
              todayQueue
                ? "grid grid-cols-1 gap-3 sm:grid-cols-2"
                : "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
            }
          >
            <Input
              label="Search"
              name="appointment-search"
              icon={<IconSearch className="size-4" />}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Appointment reference"
              containerClassName={todayQueue ? undefined : "lg:col-span-2"}
            />
            {todayQueue ? null : (
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
            )}
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
            {todayQueue ? null : (
              <>
                <Input
                  label="From date"
                  name="appointment-date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(event) => {
                    setDateFrom(event.target.value);
                    setPage(1);
                  }}
                />
                <Input
                  label="To date"
                  name="appointment-date-to"
                  type="date"
                  value={dateTo}
                  onChange={(event) => {
                    setDateTo(event.target.value);
                    setPage(1);
                  }}
                />
                {dateFrom || dateTo ? (
                  <div className="flex items-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDateFrom("");
                        setDateTo("");
                        setPage(1);
                      }}
                    >
                      <IconRefresh className="size-4" />
                      Clear dates
                    </Button>
                  </div>
                ) : null}
              </>
            )}
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
                  {todayQueue ? <TableHead>#</TableHead> : null}
                  <TableHead>Appointment</TableHead>
                  <TableHead>Date & time</TableHead>
                  <TableHead>Patient</TableHead>
                  {variant === "management" ? (
                    <TableHead>Doctor</TableHead>
                  ) : null}
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
                      <TableCell colSpan={columnCount}>
                        <div className="skeleton h-4 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : data && data.length > 0 ? (
                  data.map((appointment, index) => {
                    const badge = appointmentStatusBadge(appointment.status);
                    const typeBadge = appointmentTypeBadge(
                      appointment.appointmentType,
                    );
                    return (
                      <TableRow key={appointment.id}>
                        {todayQueue ? (
                          <TableCell className="text-xs font-semibold text-ink-muted">
                            {serialFor(index)}
                          </TableCell>
                        ) : null}
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
                        <TableCell className="max-w-48">
                          <p className="truncate text-ink">
                            {appointment.patientName ?? "�?"}
                          </p>
                          {appointment.reason ? (
                            <p
                              className="mt-0.5 truncate text-xs text-ink-muted"
                              title={appointment.reason}
                            >
                              {appointment.reason}
                            </p>
                          ) : null}
                        </TableCell>
                        {variant === "management" ? (
                          <TableCell className="max-w-40">
                            <div className="flex items-center gap-2">
                              <EntityAvatar
                                src={appointment.doctor?.profileImageUrl}
                                alt={appointment.doctor?.name ?? "Doctor"}
                                fallback={<IconStethoscope className="size-3.5" />}
                                className="size-7"
                                sizes="28px"
                              />
                              <span className="truncate">
                                {appointment.doctor?.name ?? "�?"}
                              </span>
                            </div>
                          </TableCell>
                        ) : null}
                        <TableCell className="whitespace-nowrap">
                          <Badge variant={typeBadge.variant} size="sm">
                            {typeBadge.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={badge.variant} dot>
                            {badge.label}
                          </Badge>
                          {appointment.status === "REJECTED" &&
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
                            <RowActionButtons
                              appointment={appointment}
                              variant={variant}
                              busy={busy}
                              onCancel={() => {
                                setActionError(null);
                                setDialogError(null);
                                setCancelTarget(appointment);
                              }}
                              onReject={() => {
                                setActionError(null);
                                setDialogError(null);
                                setRejectTarget(appointment);
                              }}
                              onTransition={(to) => {
                                setActionError(null);
                                setDialogError(null);
                                setTransition({ appointment, to });
                              }}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={columnCount}>
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
              {data.map((appointment, index) => {
                const badge = appointmentStatusBadge(appointment.status);
                const typeBadge = appointmentTypeBadge(
                  appointment.appointmentType,
                );
                return (
                  <li key={appointment.id} className="p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm font-semibold text-ink">
                          {todayQueue ? (
                            <span className="mr-2 text-ink-subtle">
                              #{serialFor(index)}
                            </span>
                          ) : null}
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
                      {variant === "management" && appointment.doctor ? (
                        <EntityAvatar
                          src={appointment.doctor.profileImageUrl}
                          alt={appointment.doctor.name}
                          fallback={<IconStethoscope className="size-3.5" />}
                          className="size-7"
                          sizes="28px"
                        />
                      ) : null}
                      <p className="truncate text-sm text-ink-muted">
                        {appointment.patientName ?? "Patient"}
                        {variant === "management" && appointment.doctor
                          ? ` A� ${appointment.doctor.name}`
                          : ""}
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
                    {appointment.status === "REJECTED" &&
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
                      <RowActionButtons
                        appointment={appointment}
                        variant={variant}
                        busy={busy}
                        onCancel={() => {
                          setActionError(null);
                          setDialogError(null);
                          setCancelTarget(appointment);
                        }}
                        onReject={() => {
                          setActionError(null);
                          setDialogError(null);
                          setRejectTarget(appointment);
                        }}
                        onTransition={(to) => {
                          setActionError(null);
                          setDialogError(null);
                          setTransition({ appointment, to });
                        }}
                      />
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
              title="Unable to load appointments"
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

      <AppointmentRejectDialog
        open={rejectTarget !== null}
        appointmentCode={rejectTarget?.appointmentCode ?? ""}
        loading={busy}
        error={dialogError}
        onClose={closeDialogs}
        onConfirm={(reason) =>
          rejectTarget
            ? void runAction(
                apiSend<ItemResponse<AppointmentDetail>>(
                  `/api/appointments/${rejectTarget.id}/status`,
                  "PATCH",
                  { status: "REJECTED", reason },
                ),
              )
            : undefined
        }
      />

      <ConfirmDialog
        open={transition !== null}
        title={
          transition
            ? APPOINTMENT_TRANSITION_COPY[transition.to].title
            : "Update appointment?"
        }
        description={
          transition
            ? `${transition.appointment.appointmentCode} - ${APPOINTMENT_TRANSITION_COPY[transition.to].description}`
            : ""
        }
        confirmLabel={
          transition
            ? APPOINTMENT_TRANSITION_COPY[transition.to].confirm
            : "Confirm"
        }
        cancelLabel={
          transition
            ? APPOINTMENT_TRANSITION_COPY[transition.to].cancel
            : "Cancel"
        }
        tone="primary"
        loading={busy}
        onConfirm={() =>
          transition
            ? void runAction(
                apiSend<ItemResponse<AppointmentDetail>>(
                  `/api/appointments/${transition.appointment.id}/status`,
                  "PATCH",
                  { status: transition.to },
                ),
              )
            : undefined
        }
        onCancel={closeDialogs}
      />
    </div>
  );
}

/** Status-driven action buttons for one appointment row. */
function RowActionButtons({
  appointment,
  variant,
  busy,
  onCancel,
  onReject,
  onTransition,
}: {
  appointment: AppointmentSummary;
  variant: "doctor" | "management";
  busy: boolean;
  onCancel: () => void;
  onReject: () => void;
  onTransition: (to: TransitionTarget) => void;
}) {
  const cancellable = isCancellableAppointment(appointment.status);
  const meetingLink = appointment.meetingLink;

  return (
    <>
      {meetingLink &&
      (appointment.status === "CONFIRMED" ||
        appointment.status === "IN_PROGRESS") ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            window.open(meetingLink, "_blank", "noopener,noreferrer")
          }
        >
          <IconVideo className="size-4" />
          Join
        </Button>
      ) : null}
      {variant === "doctor" ? (
        <>
          {appointment.status === "PENDING" ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => onTransition("CONFIRMED")}
              >
                <IconCheckCircle className="size-4" />
                Confirm
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={onReject}
              >
                <IconX className="size-4" />
                Reject
              </Button>
            </>
          ) : null}
          {canStartAppointment(appointment.status) ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onTransition("IN_PROGRESS")}
            >
              <IconActivity className="size-4" />
              Start
            </Button>
          ) : null}
          {canCompleteAppointment(appointment.status) ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onTransition("COMPLETED")}
            >
              <IconCheckCircle className="size-4" />
              Complete
            </Button>
          ) : null}
        </>
      ) : null}
      {cancellable ? (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={onCancel}
        >
          <IconTrash className="size-4" />
          Cancel
        </Button>
      ) : null}
    </>
  );
}
