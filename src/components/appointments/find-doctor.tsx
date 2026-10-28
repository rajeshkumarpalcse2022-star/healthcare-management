"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  IconBuilding,
  IconCalendarCheck,
  IconMapPin,
  IconSearch,
  IconStethoscope,
} from "@/components/icons";
import { EntityAvatar } from "@/components/shared/entity-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { useApiList, useDebouncedSearch } from "@/hooks/use-api-list";
import { APPOINTMENT_TYPE_LABELS } from "@/config/appointments";
import { googleMapsUrl, hasMapLocation } from "@/lib/utils/location";
import type { DoctorDirectoryEntry } from "@/types/appointment";
import { Pagination } from "../bookings/pagination";
import { buildQueryString, formatPrice } from "./shared";

/**
 * Patient-facing doctor directory (`/find-a-doctor`).
 *
 * Reads `GET /api/doctors/directory`, a public-safe projection - no email,
 * phone or registration details leave the server. Doctors without a schedule
 * are listed too but marked as not yet bookable.
 */
export function FindDoctorList() {
  const router = useRouter();
  const { search, setSearch, applied } = useDebouncedSearch();
  const [specialization, setSpecialization] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(9);

  const query = buildQueryString({
    search: applied || undefined,
    specialization: specialization || undefined,
    page,
    limit,
  });
  const { state, refresh } = useApiList<DoctorDirectoryEntry>(
    `/api/doctors/directory${query}`,
  );

  const [prevServedPage, setPrevServedPage] = React.useState(state.meta.page);
  if (state.meta.page !== prevServedPage) {
    setPrevServedPage(state.meta.page);
    if (state.meta.total > 0 && state.meta.page !== page) {
      setPage(state.meta.page);
    }
  }

  const { data, meta, loading, error } = state;
  const hasFilters = applied.length > 0 || specialization.length > 0;

  return (
    <Card>
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="Search doctors"
            name="doctor-search"
            icon={<IconSearch className="size-4" />}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Name, code or specialization"
          />
          <Input
            label="Specialization"
            name="doctor-specialization"
            value={specialization}
            onChange={(event) => {
              setSpecialization(event.target.value);
              setPage(1);
            }}
            placeholder="e.g. Cardiology"
          />
        </div>
      </div>

      {error ? (
        <div className="p-4 sm:p-5">
          <ErrorState
            title="Unable to load the doctor directory"
            description={error}
            onRetry={refresh}
          />
        </div>
      ) : loading && data === null ? (
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 sm:p-5" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="skeleton h-40 w-full rounded-card" />
          ))}
        </div>
      ) : data && data.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3 sm:p-5">
          {data.map((doctor) => (
            <article
              key={doctor.id}
              className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <EntityAvatar
                    src={doctor.profileImageUrl}
                    alt={doctor.name}
                    fallback={<IconStethoscope className="size-5" />}
                    className="size-12"
                    sizes="48px"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-ink">
                      {doctor.name}
                    </p>
                    <p className="mt-0.5 truncate text-sm text-primary">
                      {doctor.specialization}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                <Badge
                  variant={doctor.scheduleConfigured ? "success" : "warning"}
                  size="sm"
                  dot
                >
                  {doctor.scheduleConfigured ? "Bookable" : "Not configured"}
                </Badge>
                {doctor.appointmentTypes.map((type) => (
                  <Badge key={type} variant="info" size="sm">
                    {APPOINTMENT_TYPE_LABELS[type]}
                  </Badge>
                ))}
              </div>

              <dl className="flex flex-col gap-1 text-sm text-ink-muted">
                {doctor.qualification ? (
                  <div className="flex gap-2">
                    <dt className="text-ink-subtle">Qualification</dt>
                    <dd className="truncate">{doctor.qualification}</dd>
                  </div>
                ) : null}
                {doctor.experienceYears !== null ? (
                  <div className="flex gap-2">
                    <dt className="text-ink-subtle">Experience</dt>
                    <dd>{doctor.experienceYears} yrs</dd>
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <dt className="flex items-center gap-1 text-ink-subtle">
                    <IconBuilding className="size-3.5" />
                    Clinic{doctor.clinics.length > 1 ? "s" : ""}
                  </dt>
                  <dd className="flex min-w-0 flex-col gap-1.5">
                    {doctor.clinics.length === 0 ? (
                      <span>Unassigned</span>
                    ) : (
                      doctor.clinics.map((clinic) => (
                        <span
                          key={clinic.id}
                          className="flex min-w-0 items-center gap-2"
                        >
                          <EntityAvatar
                            src={clinic.imageUrl}
                            alt={clinic.name}
                            fallback={<IconBuilding className="size-3" />}
                            className="size-6"
                            sizes="24px"
                          />
                          <span className="truncate">
                            {clinic.name}
                            {clinic.city ? ` - ${clinic.city}` : ""}
                            {!clinic.scheduleConfigured
                              ? " (not bookable)"
                              : ""}
                          </span>
                          {hasMapLocation(clinic) ? (
                            <a
                              href={googleMapsUrl(
                                clinic.latitude,
                                clinic.longitude,
                              )}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Open ${clinic.name} in Google Maps`}
                              className="shrink-0 text-primary hover:text-primary-hover"
                            >
                              <IconMapPin className="size-3.5" />
                            </a>
                          ) : null}
                        </span>
                      ))
                    )}
                  </dd>
                </div>
                {doctor.consultationFee !== null ? (
                  <div className="flex gap-2">
                    <dt className="text-ink-subtle">Fee (info)</dt>
                    <dd>{formatPrice(doctor.consultationFee)}</dd>
                  </div>
                ) : null}
              </dl>

              <div className="mt-auto flex gap-2">
                <Button
                  size="sm"
                  disabled={!doctor.scheduleConfigured}
                  onClick={() => router.push(`/find-a-doctor/${doctor.id}`)}
                >
                  <IconCalendarCheck className="size-4" />
                  Book
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/find-a-doctor/${doctor.id}`)}
                >
                  View profile
                </Button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="p-4 sm:p-5">
          <EmptyState
            icon={IconSearch}
            title={hasFilters ? "No doctors match your search" : "No doctors available"}
            description={
              hasFilters
                ? "Try a different name or specialization."
                : "The doctor directory is empty right now."
            }
          />
        </div>
      )}

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
  );
}
