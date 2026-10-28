"use client";

import * as React from "react";

import {
  IconActivity,
  IconCalendarCheck,
  IconDownload,
  IconPaperclip,
  IconPencil,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, ApiRequestError } from "@/lib/api/client";
import { isConsultationEditable } from "@/components/appointments/shared";
import { appointmentStatusBadge, appointmentTypeLabel, formatDateLabel, formatDateTime } from "./shared";
import type { ItemResponse } from "@/types/api";
import type {
  AppointmentDetail,
  ConsultationRecordDto,
} from "@/types/appointment";
import { ConsultationEditorModal } from "./consultation-editor-modal";

export interface ConsultationViewProps {
  appointmentId: string;
  /** Passed by the server page; the API re-checks on every request. */
  viewerRole: "PATIENT" | "DOCTOR";
}

/**
 * Read view of one consultation record (patient after completion, treating
 * doctor any time after the record exists).
 *
 * Both fetches go through the dedicated endpoints - the appointment detail
 * for context, `/consultation` for the clinical content - so a viewer the
 * server excludes (another doctor, an admin) simply sees the "not found"
 * empty state the API returned, never clinical data.
 */
export function ConsultationView({
  appointmentId,
  viewerRole,
}: ConsultationViewProps) {
  const [attempt, setAttempt] = React.useState(0);
  const fetchKey = `${appointmentId}#${attempt}`;
  // Keyed results - loading and errors are derived from the current request
  // key, so no state is reset synchronously inside the effect.
  const [detailResult, setDetailResult] = React.useState<{
    key: string;
    detail: AppointmentDetail | null;
    error: string | null;
  } | null>(null);
  const [recordResult, setRecordResult] = React.useState<{
    key: string;
    record: ConsultationRecordDto | null;
    /** 404 message ("not available yet" / "no record") vs hard error. */
    notFound: string | null;
    error: string | null;
  } | null>(null);
  const [editorOpen, setEditorOpen] = React.useState(false);

  React.useEffect(() => {
    let active = true;

    apiGet<ItemResponse<AppointmentDetail>>(`/api/appointments/${appointmentId}`)
      .then((payload) => {
        if (active) {
          setDetailResult({
            key: fetchKey,
            detail: payload.data,
            error: null,
          });
        }
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        setDetailResult({
          key: fetchKey,
          detail: null,
          error:
            requestError instanceof ApiRequestError
              ? requestError.message
              : "Unable to load this appointment.",
        });
      });

    apiGet<ItemResponse<ConsultationRecordDto>>(
      `/api/appointments/${appointmentId}/consultation`,
    )
      .then((payload) => {
        if (active) {
          setRecordResult({
            key: fetchKey,
            record: payload.data,
            notFound: null,
            error: null,
          });
        }
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        if (
          requestError instanceof ApiRequestError &&
          requestError.status === 404
        ) {
          setRecordResult({
            key: fetchKey,
            record: null,
            notFound: requestError.message,
            error: null,
          });
        } else {
          setRecordResult({
            key: fetchKey,
            record: null,
            notFound: null,
            error:
              requestError instanceof ApiRequestError
                ? requestError.message
                : "Unable to load the consultation record.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [appointmentId, fetchKey]);

  const currentDetail =
    detailResult !== null && detailResult.key === fetchKey
      ? detailResult
      : null;
  const currentRecord =
    recordResult !== null && recordResult.key === fetchKey
      ? recordResult
      : null;
  const loading = currentDetail === null || currentRecord === null;
  const appointment = currentDetail?.detail ?? null;
  const appointmentError = currentDetail?.error ?? null;
  const record = currentRecord?.record ?? null;
  const recordNotFound = currentRecord?.notFound ?? null;
  const recordError = currentRecord?.error ?? null;

  if (loading) {
    return (
      <Card>
        <CardContent className="space-y-3" aria-hidden="true">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (appointmentError || !appointment) {
    return (
      <Card>
        <CardContent>
          <ErrorState
            title="Unable to load this consultation"
            description={appointmentError ?? "The appointment was not found."}
            onRetry={() => setAttempt((value) => value + 1)}
          />
        </CardContent>
      </Card>
    );
  }

  const badge = appointmentStatusBadge(appointment.status);
  const editable =
    viewerRole === "DOCTOR" && isConsultationEditable(appointment.status);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="font-mono">
              {appointment.appointmentCode}
            </CardTitle>
            <p className="mt-1 text-sm text-ink-muted">
              {formatDateLabel(appointment.date)} · {appointment.timeSlot} -{" "}
              {appointment.endTime} ·{" "}
              {appointmentTypeLabel(appointment.appointmentType)}
            </p>
            <p className="mt-0.5 text-sm text-ink-muted">
              {viewerRole === "PATIENT"
                ? `Dr. ${appointment.doctor?.name ?? "—"}`
                : (appointment.patient?.name ?? "Patient")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={badge.variant} dot>
              {badge.label}
            </Badge>
            {record ? (
              <>
                <a
                  href={`/api/appointments/${appointmentId}/consultation/document?type=invoice`}
                  className={buttonClasses("outline", "sm")}
                >
                  <IconDownload className="size-4" />
                  Invoice
                </a>
                <a
                  href={`/api/appointments/${appointmentId}/consultation/document?type=prescription`}
                  className={buttonClasses("outline", "sm")}
                >
                  <IconDownload className="size-4" />
                  Prescription
                </a>
              </>
            ) : null}
            {editable ? (
              <Button variant="outline" size="sm" onClick={() => setEditorOpen(true)}>
                <IconPencil className="size-4" />
                Edit record
              </Button>
            ) : null}
          </div>
        </CardHeader>
      </Card>

      {recordError ? (
        <Card>
          <CardContent>
            <ErrorState
              title="Unable to load the consultation record"
              description={recordError}
              onRetry={() => setAttempt((value) => value + 1)}
            />
          </CardContent>
        </Card>
      ) : record ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Clinical notes</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <ClinicalField
                label="Consultation notes"
                value={record.notes}
              />
              <ClinicalField
                label="Assessment / diagnosis"
                value={record.diagnosis}
              />
              <ClinicalField
                label="Treatment advice"
                value={record.treatmentAdvice}
              />
              <ClinicalField label="Follow-up" value={record.followUp} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                Prescription
                <span className="ml-2 text-sm font-normal text-ink-muted">
                  {record.prescriptionItems.length} item
                  {record.prescriptionItems.length === 1 ? "" : "s"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {record.prescriptionItems.length === 0 ? (
                <EmptyState
                  compact
                  icon={IconActivity}
                  title="No medicines prescribed"
                  description="This consultation did not include a prescription."
                />
              ) : (
                <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {record.prescriptionItems.map((item, index) => (
                    <li
                      key={`${item.medicine}-${index}`}
                      className="rounded-card border border-border bg-surface-muted/40 p-4"
                    >
                      <p className="text-sm font-semibold text-ink">
                        {item.medicine}
                      </p>
                      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs text-ink-muted">
                        <div>
                          <dt className="font-medium text-ink-subtle">Dosage</dt>
                          <dd className="mt-0.5 text-ink">{item.dosage}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-ink-subtle">
                            Frequency
                          </dt>
                          <dd className="mt-0.5 text-ink">{item.frequency}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-ink-subtle">
                            Duration
                          </dt>
                          <dd className="mt-0.5 text-ink">{item.duration}</dd>
                        </div>
                      </dl>
                      {item.instructions ? (
                        <p className="mt-2 text-xs text-ink-muted">
                          {item.instructions}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {record.attachments.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  Scans & attached prescriptions
                  <span className="ml-2 text-sm font-normal text-ink-muted">
                    {record.attachments.length} file
                    {record.attachments.length === 1 ? "" : "s"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2.5">
                  {record.attachments.map((attachment) => (
                    <li
                      key={attachment.url}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface-muted/40 px-4 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-primary-light text-primary-active">
                          <IconPaperclip className="size-4" />
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink">
                            {attachment.fileName}
                          </p>
                          <p className="text-xs text-ink-subtle">
                            {formatFileSize(attachment.size)}
                          </p>
                        </div>
                      </div>
                      <a
                        href={attachment.url}
                        target="_blank"
                        rel="noreferrer"
                        className={buttonClasses("outline", "sm")}
                      >
                        <IconDownload className="size-4" />
                        Open file
                      </a>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          {record.changeHistory && record.changeHistory.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Record history</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {record.changeHistory.map((entry, index) => (
                    <li
                      key={`${entry.changedAt}-${index}`}
                      className="flex flex-wrap items-baseline gap-x-2 text-sm"
                    >
                      <span className="text-ink-subtle">
                        {formatDateTime(entry.changedAt)}
                      </span>
                      <span className="text-ink-muted">
                        {entry.changedBy?.name ?? "Unknown"} updated{" "}
                        {entry.changedFields.join(", ")}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <p className="text-xs text-ink-subtle">
            {record.createdBy
              ? `Recorded by ${record.createdBy.name}`
              : ""}
            {record.updatedAt ? ` · Last updated ${formatDateTime(record.updatedAt)}` : ""}
          </p>
        </>
      ) : (
        <Card>
          <CardContent>
            <EmptyState
              icon={IconCalendarCheck}
              title="No consultation record yet"
              description={
                recordNotFound ??
                "The consultation record has not been created for this appointment."
              }
            />
          </CardContent>
        </Card>
      )}

      {editorOpen ? (
        <ConsultationEditorModal
          appointmentId={appointmentId}
          appointmentCode={appointment.appointmentCode}
          existing={record}
          onClose={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false);
            setAttempt((value) => value + 1);
          }}
        />
      ) : null}
    </div>
  );
}

function ClinicalField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </p>
      <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink">
        {value && value.length > 0 ? value : "—"}
      </p>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
