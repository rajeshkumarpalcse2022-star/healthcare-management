"use client";

import * as React from "react";

import {
  IconBuilding,
  IconPencil,
  IconRefresh,
  IconStethoscope,
  IconUserCheck,
} from "@/components/icons";
import { EntityAvatar } from "@/components/shared/entity-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, ApiRequestError } from "@/lib/api/client";
import type { ListResponse } from "@/types/api";
import type { Doctor } from "@/types/doctor";
import { DoctorFormModal } from "./doctor-form-modal";
import { formatBirthDate, formatFee, statusBadge } from "./shared";

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="shrink-0 text-sm text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-words text-sm font-medium text-ink">
        {value}
      </dd>
    </div>
  );
}

/**
 * Doctor profile view for the DOCTOR role.
 *
 * The list API is self-scoped server-side, so this component only ever sees
 * the caller's own record. Doctors may edit their own professional details;
 * clinic assignment, doctor code and account status remain administrator
 * managed (enforced again by `PATCH /api/doctors/me`).
 */
export function OwnDoctorProfile() {
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [editOpen, setEditOpen] = React.useState(false);
  const requestKey = `own-profile|${refreshKey}`;

  const [payload, setPayload] = React.useState<{
    requestKey: string;
    doctor: Doctor | null;
    error: string | null;
  } | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    apiGet<ListResponse<Doctor>>("/api/doctors?limit=10")
      .then((result) => {
        if (cancelled) return;
        setPayload({
          requestKey,
          doctor: result.data[0] ?? null,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPayload({
          requestKey,
          doctor: null,
          error:
            error instanceof ApiRequestError
              ? error.message
              : "Unable to load your doctor profile.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  const loading = payload === null || payload.requestKey !== requestKey;
  const doctor = payload?.doctor ?? null;
  const error = payload?.error ?? null;

  if (loading) {
    return (
      <Card>
        <CardContent className="p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <Skeleton className="size-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
          <div className="mt-6 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-4 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Unable to load your profile"
        description={error}
        onRetry={() => setRefreshKey((value) => value + 1)}
      />
    );
  }

  if (!doctor) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={IconUserCheck}
            title="No doctor profile linked to your account"
            description="An administrator can create your doctor profile and link it to your login. Until then there is nothing to display here."
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRefreshKey((value) => value + 1)}
              >
                <IconRefresh className="size-4" />
                Refresh
              </Button>
            }
          />
        </CardContent>
      </Card>
    );
  }

  const badge = statusBadge(doctor.isActive);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <EntityAvatar
            src={doctor.profileImageUrl}
            alt={doctor.name}
            fallback={<IconStethoscope className="size-6" />}
            className="size-12"
            sizes="48px"
          />
          <div className="min-w-0">
            <CardTitle className="text-lg">{doctor.name}</CardTitle>
            <p className="mt-1 text-sm text-ink-muted">
              {doctor.specialization}
              {doctor.qualification ? ` · ${doctor.qualification}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={badge.variant} dot>
                {badge.label}
              </Badge>
              <Badge variant="primary" size="sm">
                {doctor.doctorCode}
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setEditOpen(true)}>
            <IconPencil className="size-4" />
            Edit profile
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            <IconRefresh className="size-4" />
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <dl className="divide-y divide-border">
          <DetailRow label="Email" value={doctor.email} />
          <DetailRow label="Phone" value={doctor.phone ?? "—"} />
          <DetailRow
            label={doctor.clinics.length > 1 ? "Clinics" : "Clinic"}
            value={
              doctor.clinics.length > 0
                ? doctor.clinics
                    .map(
                      (clinic) =>
                        `${clinic.name} (${clinic.code})${
                          clinic.id === doctor.clinic?.id ? " - primary" : ""
                        }`,
                    )
                    .join(", ")
                : "Unassigned"
            }
          />
          <DetailRow
            label="Location"
            value={doctor.clinic?.city ?? "—"}
          />
          <DetailRow
            label="Registration number"
            value={doctor.registrationNumber ?? "—"}
          />
          <DetailRow
            label="Experience"
            value={
              doctor.experienceYears === null
                ? "—"
                : `${doctor.experienceYears} years`
            }
          />
          <DetailRow
            label="Consultation fee"
            value={formatFee(doctor.consultationFee)}
          />
          <DetailRow
            label="Date of birth"
            value={formatBirthDate(doctor.dateOfBirth)}
          />
          <DetailRow
            label="Gender"
            value={doctor.gender ?? "—"}
          />
        </dl>

        {doctor.bio ? (
          <div className="mt-5 rounded-control border border-border bg-surface-muted p-4">
            <p className="text-sm text-ink-muted">{doctor.bio}</p>
          </div>
        ) : null}

        <p className="mt-5 flex items-center gap-2 text-xs text-ink-subtle">
          <IconBuilding className="size-3.5" aria-hidden="true" />
          Profile data only - your login credentials are managed separately.
        </p>
      </CardContent>

      <DoctorFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        doctor={doctor}
        selfEdit
        onSaved={(saved) => {
          setEditOpen(false);
          setPayload((current) =>
            current
              ? { ...current, doctor: saved, error: null }
              : { requestKey, doctor: saved, error: null },
          );
        }}
      />
    </Card>
  );
}
