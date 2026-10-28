"use client";

import * as React from "react";
import Link from "next/link";

import { appointmentTypeLabel } from "@/config/appointments";
import { Button, buttonClasses } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/ui/error-state";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, ApiRequestError } from "@/lib/api/client";
import type { ItemResponse } from "@/types/api";
import type {
  DoctorPatientDetail,
  DoctorPatientSummary,
  DoctorPatientVisit,
  DoctorPatientVisitConsultation,
} from "@/types/patient";

interface DoctorPatientDetailModalProps {
  patient: DoctorPatientSummary | null;
  onClose: () => void;
}

function formatDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString(undefined, {
        timeZone: "UTC",
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-control border border-border bg-surface-muted/50 px-3 py-2.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
        {label}
      </dt>
      <dd className="mt-0.5 break-words text-sm font-medium text-ink">
        {value}
      </dd>
    </div>
  );
}

function ConsultationSummary({
  consultation,
}: {
  consultation: DoctorPatientVisitConsultation;
}) {
  return (
    <dl className="mt-3 grid gap-2 border-t border-border/70 pt-3 text-sm sm:grid-cols-2">
      <div>
        <dt className="text-xs font-medium text-ink-subtle">Diagnosis</dt>
        <dd className="mt-0.5 text-ink">
          {consultation.diagnosis ?? "Not recorded"}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-ink-subtle">Treatment advice</dt>
        <dd className="mt-0.5 text-ink">
          {consultation.treatmentAdvice ?? "Not recorded"}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-ink-subtle">Follow-up</dt>
        <dd className="mt-0.5 text-ink">
          {consultation.followUp ?? "Not recorded"}
        </dd>
      </div>
      <div>
        <dt className="text-xs font-medium text-ink-subtle">Prescription</dt>
        <dd className="mt-0.5 text-ink">
          {consultation.prescriptionCount}{" "}
          {consultation.prescriptionCount === 1 ? "medicine" : "medicines"}
        </dd>
      </div>
    </dl>
  );
}

function VisitRow({ visit }: { visit: DoctorPatientVisit }) {
  return (
    <li className="rounded-control border border-border bg-surface px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-ink">
            {formatDate(visit.date)} · {visit.timeSlot}–{visit.endTime}
          </p>
          <p className="mt-0.5 text-xs text-ink-subtle">
            {visit.appointmentCode}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="info" size="sm">
            {appointmentTypeLabel(visit.appointmentType)}
          </Badge>
          <Link
            href={`/appointments/${visit.id}`}
            className={buttonClasses("outline", "sm")}
          >
            Open visit
          </Link>
        </div>
      </div>

      {visit.reason ? (
        <p className="mt-2 text-sm text-ink-muted">
          <span className="font-medium text-ink">Reason: </span>
          {visit.reason}
        </p>
      ) : null}

      {visit.consultation ? (
        <ConsultationSummary consultation={visit.consultation} />
      ) : (
        <p className="mt-3 border-t border-border/70 pt-3 text-sm text-ink-subtle">
          No consultation notes were saved for this visit.
        </p>
      )}
    </li>
  );
}

function ModalContent({
  patient,
  payload,
  error,
  loading,
  onRetry,
}: {
  patient: DoctorPatientSummary;
  payload: DoctorPatientDetail | null;
  error: string | null;
  loading: boolean;
  onRetry: () => void;
}) {
  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Patient details could not be loaded"
        description={error}
        onRetry={onRetry}
      />
    );
  }

  if (!payload) {
    return null;
  }

  return (
    <div className="space-y-5">
      <dl className="grid gap-3 sm:grid-cols-2">
        <InfoTile label="Email" value={payload.patient.email} />
        <InfoTile label="Phone" value={payload.patient.phone ?? "Not provided"} />
        <InfoTile label="First visit" value={formatDate(payload.patient.firstVisit)} />
        <InfoTile label="Last visit" value={formatDate(payload.patient.lastVisit)} />
      </dl>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">Completed visits</h3>
          <Badge variant="success" size="sm">
            {payload.visits.length}{" "}
            {payload.visits.length === 1 ? "visit" : "visits"}
          </Badge>
        </div>

        <ul className="mt-3 space-y-3">
          {payload.visits.map((visit) => (
            <VisitRow key={visit.id} visit={visit} />
          ))}
        </ul>
      </div>

      <p className="text-xs text-ink-subtle">
        Showing visits completed with {patient.name}. Open a visit to view the
        full appointment and consultation record.
      </p>
    </div>
  );
}

/**
 * Patient-detail dialog opened from the eye action in the doctor patient list.
 *
 * Fetches `GET /api/doctor/patients/[id]`, which is hard-scoped to the
 * signed-in doctor and only returns patients with a COMPLETED appointment.
 */
export function DoctorPatientDetailModal({
  patient,
  onClose,
}: DoctorPatientDetailModalProps) {
  const [refreshKey, setRefreshKey] = React.useState(0);
  const requestKey = patient ? `${patient.id}|${refreshKey}` : "";

  const [result, setResult] = React.useState<{
    requestKey: string;
    detail: DoctorPatientDetail | null;
    error: string | null;
  } | null>(null);

  React.useEffect(() => {
    if (!patient) return;
    let cancelled = false;

    apiGet<ItemResponse<DoctorPatientDetail>>(
      `/api/doctor/patients/${patient.id}`,
    )
      .then((response) => {
        if (cancelled) return;
        setResult({
          requestKey,
          detail: response.data,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setResult({
          requestKey,
          detail: null,
          error:
            error instanceof ApiRequestError
              ? error.message
              : "Unable to load this patient right now.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [patient, requestKey]);

  const active = result !== null && result.requestKey === requestKey;
  const loading = Boolean(patient) && !active;
  const detail = active ? result.detail : null;
  const error = active ? result.error : null;

  return (
    <Modal
      open={patient !== null}
      onClose={onClose}
      title={patient?.name ?? "Patient details"}
      description="Patient details and completed visits with you"
      size="lg"
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      }
    >
      {patient ? (
        <ModalContent
          patient={patient}
          payload={detail}
          error={error}
          loading={loading}
          onRetry={() => setRefreshKey((value) => value + 1)}
        />
      ) : null}
    </Modal>
  );
}
