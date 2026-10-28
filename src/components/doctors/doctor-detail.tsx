"use client";

import * as React from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  IconAlertTriangle,
  IconBuilding,
  IconChevronLeft,
  IconMapPin,
  IconPencil,
  IconPower,
  IconRefresh,
  IconStethoscope,
} from "@/components/icons";
import { EntityAvatar } from "@/components/shared/entity-avatar";
import { PageHeader } from "@/components/shared/page-header";
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
import { canManageModule } from "@/config/doctors";
import type { Role } from "@/config/roles";
import { apiGet, apiSend, ApiRequestError } from "@/lib/api/client";
import { googleMapsUrl, hasMapLocation } from "@/lib/utils/location";
import type { ItemResponse, ListResponse } from "@/types/api";
import type { Clinic } from "@/types/clinic";
import type { Doctor } from "@/types/doctor";
import { ConfirmDialog } from "./confirm-dialog";
import { DoctorFormModal } from "./doctor-form-modal";
import { formatBirthDate, formatFee, statusBadge } from "./shared";

export interface DoctorDetailProps {
  id: string;
  role: Role;
}

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
 * Doctor detail screen: full profile, clinic assignment and the edit /
 * status actions available to admin roles.
 */
export function DoctorDetail({ id, role }: DoctorDetailProps) {
  const router = useRouter();

  const [refreshKey, setRefreshKey] = React.useState(0);
  const requestKey = `doctor-${id}|${refreshKey}`;

  const [payload, setPayload] = React.useState<{
    requestKey: string;
    doctor: Doctor | null;
    error: string | null;
  } | null>(null);

  const [clinicOptions, setClinicOptions] = React.useState<
    { value: string; label: string }[]
  >([]);
  const [clinicsError, setClinicsError] = React.useState<string | null>(null);

  const [formOpen, setFormOpen] = React.useState(false);
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [statusLoading, setStatusLoading] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const managed = canManageModule(role);

  React.useEffect(() => {
    let cancelled = false;

    apiGet<ItemResponse<Doctor>>(`/api/doctors/${id}`)
      .then((result) => {
        if (cancelled) return;
        setPayload({ requestKey, doctor: result.data, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPayload({
          requestKey,
          doctor: null,
          error:
            error instanceof ApiRequestError
              ? error.message
              : "Unable to load the doctor right now.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [id, requestKey]);

  React.useEffect(() => {
    if (!managed) return;
    let cancelled = false;

    apiGet<ListResponse<Clinic>>("/api/clinics?status=active&limit=50")
      .then((result) => {
        if (cancelled) return;
        setClinicOptions(
          result.data.map((clinic) => ({
            value: clinic.id,
            label: `${clinic.name} (${clinic.code})`,
          })),
        );
        setClinicsError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setClinicOptions([]);
        setClinicsError(
          error instanceof ApiRequestError
            ? error.message
            : "Unable to load the clinic list.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [managed]);

  const loading = payload === null || payload.requestKey !== requestKey;
  const doctor = payload?.doctor ?? null;
  const error = payload?.error ?? null;

  async function handleStatusToggle() {
    if (!doctor || statusLoading) return;
    setStatusLoading(true);
    setActionError(null);

    try {
      const result = await apiSend<ItemResponse<Doctor>>(
        `/api/doctors/${doctor.id}/status`,
        "PATCH",
        { isActive: !doctor.isActive },
      );
      setPayload({
        requestKey,
        doctor: result.data,
        error: null,
      });
      setStatusOpen(false);
    } catch (err) {
      setStatusOpen(false);
      setActionError(
        err instanceof ApiRequestError
          ? err.message
          : "Unable to update the doctor status.",
      );
    } finally {
      setStatusLoading(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader
          eyebrow="Doctor / Clinic"
          title="Doctor profile"
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Doctor / Clinic", href: "/doctors" },
            { label: "Details" },
          ]}
        />
        <Card>
          <CardContent className="p-5 sm:p-6">
            <div className="flex items-center gap-4">
              <Skeleton className="size-14 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-3.5 w-64" />
              </div>
            </div>
            <div className="mt-6 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
              {Array.from({ length: 8 }, (_, index) => (
                <Skeleton key={index} className="h-4 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  if (error || !doctor) {
    return (
      <>
        <PageHeader
          eyebrow="Doctor / Clinic"
          title="Doctor profile"
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Doctor / Clinic", href: "/doctors" },
            { label: "Details" },
          ]}
          actions={
            <Link
              href="/doctors"
              className="inline-flex h-9 items-center gap-1.5 rounded-control border border-border bg-transparent px-3 text-sm font-medium text-ink shadow-sm transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              <IconChevronLeft className="size-4" />
              Back to directory
            </Link>
          }
        />
        <ErrorState
          title="Unable to load this doctor"
          description={error ?? "Doctor not found."}
          onRetry={() => setRefreshKey((value) => value + 1)}
        />
      </>
    );
  }

  const badge = statusBadge(doctor.isActive);

  return (
    <>
      <PageHeader
        eyebrow="Doctor / Clinic"
        title={doctor.name}
        description={doctor.specialization}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Doctor / Clinic", href: "/doctors" },
          { label: doctor.name },
        ]}
        actions={
          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRefreshKey((value) => value + 1)}
            >
              <IconRefresh className="size-4" />
              Refresh
            </Button>
            {managed ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setFormOpen(true)}
                >
                  <IconPencil className="size-4" />
                  Edit
                </Button>
                <Button
                  variant={doctor.isActive ? "danger" : "primary"}
                  size="sm"
                  onClick={() => setStatusOpen(true)}
                >
                  <IconPower className="size-4" />
                  {doctor.isActive ? "Deactivate" : "Activate"}
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <div className="flex items-center gap-3">
        <EntityAvatar
          src={doctor.profileImageUrl}
          alt={doctor.name}
          fallback={<IconStethoscope className="size-7" />}
          className="size-14"
          sizes="56px"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={badge.variant} dot>
            {badge.label}
          </Badge>
          <Badge variant="primary" size="sm">
            {doctor.doctorCode}
          </Badge>
        </div>
      </div>

      {actionError ? (
        <p
          role="alert"
          className="mt-4 rounded-control border border-danger-line bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
        >
          {actionError}
        </p>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary-hover dark:bg-primary/10 dark:text-brand-400"
                  aria-hidden="true"
                >
                  <IconStethoscope className="size-5" />
                </span>
                <CardTitle>Profile information</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border">
                <DetailRow label="Full name" value={doctor.name} />
                <DetailRow label="Email" value={doctor.email} />
                <DetailRow label="Phone" value={doctor.phone ?? "—"} />
                <DetailRow
                  label="Specialization"
                  value={doctor.specialization}
                />
                <DetailRow
                  label="Qualification"
                  value={doctor.qualification ?? "—"}
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
                  label="Gender"
                  value={doctor.gender ?? "—"}
                />
                <DetailRow
                  label="Date of birth"
                  value={formatBirthDate(doctor.dateOfBirth)}
                />
              </dl>

              {doctor.bio ? (
                <div className="mt-5 rounded-control border border-border bg-surface-muted p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-ink-subtle">
                    Bio
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                    {doctor.bio}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary-hover dark:bg-primary/10 dark:text-brand-400"
                  aria-hidden="true"
                >
                  <IconBuilding className="size-5" />
                </span>
                <CardTitle>Clinic assignment</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {doctor.clinics.length > 0 ? (
                <ul className="flex flex-col gap-3">
                  {doctor.clinics.map((clinic) => (
                    <li
                      key={clinic.id}
                      className="rounded-control border border-border bg-surface-muted p-4"
                    >
                      <div className="flex items-start gap-3">
                        <EntityAvatar
                          src={clinic.imageUrl}
                          alt={clinic.name}
                          fallback={<IconBuilding className="size-5" />}
                          className="size-10"
                          sizes="40px"
                        />
                        <div className="min-w-0">
                          <p className="font-semibold text-ink">
                            {clinic.name}
                            {clinic.id === doctor.clinic?.id ? (
                              <span className="ml-2 text-xs font-medium text-primary">
                                Primary
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-sm text-ink-muted">
                            {[clinic.city, clinic.code]
                              .filter(Boolean)
                              .join(" - ")}
                          </p>
                          <div className="mt-2.5 flex flex-wrap items-center gap-3">
                            <Badge
                              variant={clinic.isActive ? "success" : "neutral"}
                              dot
                              size="sm"
                            >
                              {clinic.isActive ? "Clinic active" : "Clinic inactive"}
                            </Badge>
                            {hasMapLocation(clinic) ? (
                              <a
                                href={googleMapsUrl(
                                  clinic.latitude,
                                  clinic.longitude,
                                )}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                              >
                                <IconMapPin className="size-3.5" aria-hidden="true" />
                                Open clinic in Maps
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rounded-control border border-dashed border-border p-4 text-sm text-ink-muted">
                  <span className="flex items-start gap-2">
                    <IconAlertTriangle
                      className="mt-0.5 size-4 shrink-0 text-warning"
                      aria-hidden="true"
                    />
                    This doctor is not assigned to a clinic.
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Record</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border">
                <DetailRow
                  label="Doctor code"
                  value={doctor.doctorCode}
                />
                <DetailRow
                  label="Status"
                  value={badge.label}
                />
                <DetailRow
                  label="Created"
                  value={new Date(doctor.createdAt).toLocaleString()}
                />
                <DetailRow
                  label="Last updated"
                  value={new Date(doctor.updatedAt).toLocaleString()}
                />
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-6">
        <Button
          variant="link"
          size="sm"
          onClick={() => router.push("/doctors")}
        >
          <IconChevronLeft className="size-4" />
          Back to doctor directory
        </Button>
      </div>

      <DoctorFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        doctor={doctor}
        clinicOptions={clinicOptions}
        clinicsError={clinicsError}
        onSaved={(saved) => {
          setPayload({ requestKey, doctor: saved, error: null });
          setRefreshKey((value) => value + 1);
        }}
      />

      <ConfirmDialog
        open={statusOpen}
        title={doctor.isActive ? "Deactivate doctor?" : "Activate doctor?"}
        description={
          doctor.isActive
            ? `${doctor.name} will be marked inactive and hidden from active lists. You can reactivate at any time.`
            : `${doctor.name} will be marked active and available in the directory.`
        }
        confirmLabel={doctor.isActive ? "Deactivate" : "Activate"}
        tone={doctor.isActive ? "danger" : "primary"}
        loading={statusLoading}
        onCancel={() => setStatusOpen(false)}
        onConfirm={() => void handleStatusToggle()}
      />
    </>
  );
}
