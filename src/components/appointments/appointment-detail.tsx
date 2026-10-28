"use client";

import * as React from "react";
import Link from "next/link";

import {
  IconActivity,
  IconBuilding,
  IconCalendarCheck,
  IconCheckCircle,
  IconCopy,
  IconPencil,
  IconRefresh,
  IconStethoscope,
  IconTrash,
  IconVideo,
  IconX,
} from "@/components/icons";
import { ConfirmDialog } from "@/components/bookings/confirm-dialog";
import { EntityAvatar } from "@/components/shared/entity-avatar";
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
import { apiGet, apiSend, ApiRequestError } from "@/lib/api/client";
import type { Role } from "@/config/roles";
import { canViewAppointmentManagement } from "@/config/appointments";
import type { ItemResponse } from "@/types/api";
import type { AppointmentDetail } from "@/types/appointment";
import { AppointmentCancelDialog, AppointmentRejectDialog } from "./appointment-dialogs";
import { ConsultationEditorModal } from "./consultation-editor-modal";
import { RescheduleDialog } from "./reschedule-dialog";
import {
  APPOINTMENT_TRANSITION_COPY,
  appointmentStatusBadge,
  appointmentTypeBadge,
  canCompleteAppointment,
  canStartAppointment,
  formatDateLabel,
  formatDateTime,
  isCancellableAppointment,
  isConsultationEditable,
  issuesToErrors,
  notifyAppointmentsChanged,
  type AppointmentTransitionTarget,
  type FieldErrors,
} from "./shared";

export interface AppointmentDetailPanelProps {
  appointmentId: string;
  /** Session role passed by the server page; the API re-checks every action. */
  role: Role;
}

/**
 * Shared appointment detail view for the patient, the treating doctor and
 * administrative monitors.
 *
 * Reads `GET /api/appointments/[id]`, which returns 404 to anyone outside
 * the visibility rule (owning patient, owning doctor, super admin / admin).
 * Every action button is derived from role + status but the server remains
 * the authority - stale status clicks surface as a banner with a refresh.
 */
export function AppointmentDetailPanel({
  appointmentId,
  role,
}: AppointmentDetailPanelProps) {
  const [attempt, setAttempt] = React.useState(0);
  // Keyed result: `loading` / `error` are derived from whether the payload
  // matches the current request key, so the effect never resets state
  // synchronously (react-hooks/set-state-in-effect).
  const [fetchResult, setFetchResult] = React.useState<{
    key: string;
    detail: AppointmentDetail | null;
    error: string | null;
  } | null>(null);
  const fetchKey = `${appointmentId}#${attempt}`;

  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [rejectOpen, setRejectOpen] = React.useState(false);
  const [rescheduleOpen, setRescheduleOpen] = React.useState(false);
  const [transition, setTransition] =
    React.useState<AppointmentTransitionTarget | null>(null);
  const [editorOpen, setEditorOpen] = React.useState(false);
  const [dialogError, setDialogError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [linkCopied, setLinkCopied] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    apiGet<ItemResponse<AppointmentDetail>>(`/api/appointments/${appointmentId}`)
      .then((payload) => {
        if (active) {
          setFetchResult({
            key: fetchKey,
            detail: payload.data,
            error: null,
          });
        }
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        setFetchResult({
          key: fetchKey,
          detail: null,
          error:
            requestError instanceof ApiRequestError
              ? requestError.message
              : "Unable to load this appointment.",
        });
      });
    return () => {
      active = false;
    };
  }, [appointmentId, fetchKey]);

  const current =
    fetchResult !== null && fetchResult.key === fetchKey ? fetchResult : null;
  const loading = current === null;
  const detail = current?.detail ?? null;
  const error = current?.error ?? null;

  function refetch() {
    setAttempt((value) => value + 1);
  }

  function closeDialogs() {
    setCancelOpen(false);
    setRejectOpen(false);
    setRescheduleOpen(false);
    setTransition(null);
    setDialogError(null);
  }

  async function copyMeetingLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setLinkCopied(true);
      window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setActionError("Could not copy the link. Please copy it manually.");
    }
  }

  async function runAction(request: Promise<unknown>) {
    setBusy(true);
    setDialogError(null);
    setActionError(null);
    try {
      await request;
      closeDialogs();
      refetch();
      notifyAppointmentsChanged();
    } catch (requestError) {
      if (requestError instanceof ApiRequestError) {
        const issues: FieldErrors = issuesToErrors(requestError.issues);
        const fieldError =
          issues.reason ?? issues.timeSlot ?? issues.appointmentDate;
        if (fieldError) {
          setDialogError(fieldError);
        } else {
          setActionError(requestError.message);
          closeDialogs();
          refetch();
        }
      } else {
        setActionError("Unable to update the appointment. Please try again.");
        closeDialogs();
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="space-y-3" aria-hidden="true">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (error || !detail) {
    return (
      <Card>
        <CardContent>
          <ErrorState
            title="Unable to load this appointment"
            description={error ?? "The appointment was not found."}
            onRetry={refetch}
          />
        </CardContent>
      </Card>
    );
  }

  const badge = appointmentStatusBadge(detail.status);
  const typeBadge = appointmentTypeBadge(detail.appointmentType);
  const isPatient = role === "PATIENT";
  const isDoctor = role === "DOCTOR";
  const isManagement = canViewAppointmentManagement(role);
  const cancellable = isCancellableAppointment(detail.status);
  const canReview = isDoctor && detail.status === "PENDING";
  const canStart = isDoctor && canStartAppointment(detail.status);
  const canComplete = isDoctor && canCompleteAppointment(detail.status);
  const editableConsultation = isDoctor && isConsultationEditable(detail.status);
  const isOnline = detail.appointmentType === "ONLINE";
  const meetingLink = detail.meetingLink;

  return (
    <div className="flex flex-col gap-4">
      {actionError ? (
        <p
          role="alert"
          className="rounded-card border border-danger-line bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          {actionError}
        </p>
      ) : null}

      {/* Header + actions */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="font-mono">{detail.appointmentCode}</CardTitle>
              <Badge variant={badge.variant} dot>
                {badge.label}
              </Badge>
              <Badge variant={typeBadge.variant} size="sm">
                {typeBadge.label}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              {formatDateLabel(detail.date)} · {detail.timeSlot} -{" "}
              {detail.endTime} · {detail.timezone}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canReview ? (
              <>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() => setTransition("CONFIRMED")}
                >
                  <IconCheckCircle className="size-4" />
                  Confirm
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setRejectOpen(true)}
                >
                  <IconX className="size-4" />
                  Reject
                </Button>
              </>
            ) : null}
            {canStart ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => setTransition("IN_PROGRESS")}
              >
                <IconActivity className="size-4" />
                Start consultation
              </Button>
            ) : null}
            {canComplete ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => setTransition("COMPLETED")}
              >
                <IconCheckCircle className="size-4" />
                Complete
              </Button>
            ) : null}
            {editableConsultation ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditorOpen(true)}
              >
                <IconPencil className="size-4" />
                {detail.hasConsultation ? "Edit record" : "Record consultation"}
              </Button>
            ) : null}
            {cancellable && (isPatient || isDoctor || isManagement) ? (
              <>
                {isPatient ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setRescheduleOpen(true)}
                  >
                    <IconRefresh className="size-4" />
                    Reschedule
                  </Button>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setCancelOpen(true)}
                >
                  <IconTrash className="size-4" />
                  Cancel
                </Button>
              </>
            ) : null}
          </div>
        </CardHeader>
      </Card>

      {/* Facts */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Appointment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Fact
              label="Doctor"
              value={
                detail.doctor
                  ? `${detail.doctor.name} · ${detail.doctor.specialization}`
                  : "—"
              }
              media={
                detail.doctor ? (
                  <EntityAvatar
                    src={detail.doctor.profileImageUrl}
                    alt={detail.doctor.name}
                    fallback={<IconStethoscope className="size-5" />}
                    className="size-10"
                    sizes="40px"
                  />
                ) : null
              }
            />
            <Fact
              label="Clinic"
              value={
                detail.clinic
                  ? `${detail.clinic.name}${detail.clinic.city ? ` · ${detail.clinic.city}` : ""}`
                  : "—"
              }
              media={
                detail.clinic ? (
                  <EntityAvatar
                    src={detail.clinic.imageUrl}
                    alt={detail.clinic.name}
                    fallback={<IconBuilding className="size-4" />}
                    className="size-8"
                    sizes="32px"
                  />
                ) : null
              }
            />
            <Fact
              label="Patient"
              value={detail.patient?.name ?? detail.patientName ?? "—"}
              secondary={
                detail.patient?.phone
                  ? detail.patient.phone
                  : detail.patient?.email ?? undefined
              }
            />
            <Fact label="Reason" value={detail.reason ?? "—"} />
            {isOnline &&
            (detail.status === "CONFIRMED" ||
              detail.status === "IN_PROGRESS") ? (
              meetingLink ? (
                <div className="space-y-2.5 rounded-lg border border-border bg-surface-muted px-3 py-2.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                    Online consultation link
                  </p>
                  <p className="break-all text-sm text-ink">{meetingLink}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
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
                      Join consultation
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void copyMeetingLink(meetingLink)}
                    >
                      <IconCopy className="size-4" />
                      {linkCopied ? "Copied" : "Copy link"}
                    </Button>
                  </div>
                  <p className="text-xs text-ink-subtle">
                    Opens in your browser - no app or account needed. Share it
                    only with the patient.
                  </p>
                </div>
              ) : (
                <p className="rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-ink-muted">
                  Online consultation - the meeting link has not been generated
                  yet.
                </p>
              )
            ) : null}
            {isOnline && detail.status === "PENDING" ? (
              <p className="rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-ink-muted">
                Online consultation - the meeting link is created automatically
                once the doctor confirms this appointment.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Fact label="Requested" value={formatDateTime(detail.createdAt)} />
            {detail.reviewedAt ? (
              <Fact
                label="Reviewed"
                value={formatDateTime(detail.reviewedAt)}
                secondary={
                  detail.reviewedBy ? `by ${detail.reviewedBy.name}` : undefined
                }
              />
            ) : null}
            {detail.startedAt ? (
              <Fact
                label="Started"
                value={formatDateTime(detail.startedAt)}
                secondary={
                  detail.startedBy ? `by ${detail.startedBy.name}` : undefined
                }
              />
            ) : null}
            {detail.completedAt ? (
              <Fact
                label="Completed"
                value={formatDateTime(detail.completedAt)}
                secondary={
                  detail.completedBy ? `by ${detail.completedBy.name}` : undefined
                }
              />
            ) : null}
            {detail.cancelledAt ? (
              <Fact
                label="Cancelled"
                value={formatDateTime(detail.cancelledAt)}
              />
            ) : null}
            {detail.rejectionReason ? (
              <Fact
                label="Rejection reason"
                value={detail.rejectionReason}
              />
            ) : null}
            {detail.cancellationReason ? (
              <Fact
                label="Cancellation reason"
                value={detail.cancellationReason}
              />
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Consultation access */}
      <Card>
        <CardHeader>
          <CardTitle>Consultation record</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">
            {detail.hasConsultation
              ? "A consultation record exists for this appointment."
              : "No consultation record has been written for this appointment yet."}
          </p>
          {isPatient && detail.hasConsultation && detail.status === "COMPLETED" ? (
            <Link href={`/medical-records/${detail.id}`} className="inline-flex">
              <Button variant="outline" size="sm">
                <IconCalendarCheck className="size-4" />
                View record
              </Button>
            </Link>
          ) : isPatient ? (
            <p className="text-xs text-ink-subtle">
              The record becomes visible once the consultation is completed.
            </p>
          ) : editableConsultation ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditorOpen(true)}
            >
              <IconPencil className="size-4" />
              {detail.hasConsultation ? "Open record" : "Start record"}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      {/* Audit history */}
      {detail.history && detail.history.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {detail.history.map((event) => (
                <li
                  key={event.id}
                  className="flex flex-wrap items-baseline gap-x-2 text-sm"
                >
                  <span className="text-ink-subtle">
                    {formatDateTime(event.createdAt)}
                  </span>
                  <span className="font-medium text-ink">{event.eventLabel}</span>
                  {event.actor ? (
                    <span className="text-ink-muted">by {event.actor.name}</span>
                  ) : null}
                  {event.reason ? (
                    <span className="text-ink-muted">- {event.reason}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* Dialogs */}
      <AppointmentCancelDialog
        open={cancelOpen}
        appointmentCode={detail.appointmentCode}
        loading={busy}
        error={dialogError}
        onCancel={closeDialogs}
        onConfirm={(reason) =>
          void runAction(
            apiSend<ItemResponse<AppointmentDetail>>(
              `/api/appointments/${detail.id}/cancel`,
              "PATCH",
              { reason: reason.length > 0 ? reason : null },
            ),
          )
        }
      />

      <AppointmentRejectDialog
        open={rejectOpen}
        appointmentCode={detail.appointmentCode}
        loading={busy}
        error={dialogError}
        onClose={closeDialogs}
        onConfirm={(reason) =>
          void runAction(
            apiSend<ItemResponse<AppointmentDetail>>(
              `/api/appointments/${detail.id}/status`,
              "PATCH",
              { status: "REJECTED", reason },
            ),
          )
        }
      />

      <ConfirmDialog
        open={transition !== null}
        title={
          transition ? APPOINTMENT_TRANSITION_COPY[transition].title : "Update?"
        }
        description={
          transition
            ? `${detail.appointmentCode} - ${APPOINTMENT_TRANSITION_COPY[transition].description}`
            : ""
        }
        confirmLabel={
          transition ? APPOINTMENT_TRANSITION_COPY[transition].confirm : "Confirm"
        }
        cancelLabel={
          transition ? APPOINTMENT_TRANSITION_COPY[transition].cancel : "Cancel"
        }
        tone="primary"
        loading={busy}
        onConfirm={() =>
          transition
            ? void runAction(
                apiSend<ItemResponse<AppointmentDetail>>(
                  `/api/appointments/${detail.id}/status`,
                  "PATCH",
                  { status: transition },
                ),
              )
            : undefined
        }
        onCancel={closeDialogs}
      />

      {rescheduleOpen ? (
        <RescheduleDialog
          open
          appointment={detail}
          loading={busy}
          error={dialogError}
          onClose={closeDialogs}
          onConfirm={(date, timeSlot) =>
            void runAction(
              apiSend<ItemResponse<AppointmentDetail>>(
                `/api/appointments/${detail.id}/reschedule`,
                "PATCH",
                { appointmentDate: date, timeSlot },
              ),
            )
          }
        />
      ) : null}

      {editorOpen ? (
        <ConsultationEditorModal
          appointmentId={detail.id}
          appointmentCode={detail.appointmentCode}
          existing={null}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false);
            refetch();
          }}
        />
      ) : null}
    </div>
  );
}

function Fact({
  label,
  value,
  secondary,
  media,
}: {
  label: string;
  value: string;
  secondary?: string;
  media?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </p>
      <div className="mt-0.5 flex items-center gap-2.5">
        {media}
        <div className="min-w-0">
          <p className="text-sm text-ink">{value}</p>
          {secondary ? (
            <p className="mt-0.5 text-xs text-ink-muted">{secondary}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
