"use client";

import * as React from "react";

import {
  IconPencil,
  IconPlus,
  IconPower,
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
import { SPECIALIZATIONS } from "@/config/doctors";
import { apiSend, ApiRequestError } from "@/lib/api/client";
import { useApiList, useDebouncedSearch } from "@/hooks/use-api-list";
import type { Doctor } from "@/types/doctor";
import { DoctorFormModal } from "./doctor-form-modal";
import { ConfirmDialog } from "./confirm-dialog";
import { Pagination } from "./pagination";
import { buildQueryString, STATUS_OPTIONS, statusBadge } from "./shared";

const specializationOptions = [
  { value: "", label: "All specializations" },
  ...SPECIALIZATIONS.map((value) => ({ value, label: value })),
];

function buildClinicOptions(
  clinics: { value: string; label: string }[],
): { value: string; label: string }[] {
  return [{ value: "", label: "All clinics" }, ...clinics];
}

export interface DoctorsTabProps {
  clinicOptions: { value: string; label: string }[];
  clinicsError: string | null;
  /** Called after a save so the module can refresh clinic option lists. */
  onDirectoryChanged: () => void;
}

/**
 * Doctor directory: server-side search, filters, pagination and the
 * create / edit / status actions available to admin roles.
 */
export function DoctorsTab({
  clinicOptions,
  clinicsError,
  onDirectoryChanged,
}: DoctorsTabProps) {
  const { search, setSearch, applied: debouncedSearch } =
    useDebouncedSearch();
  const [specialization, setSpecialization] = React.useState("");
  const [clinicFilter, setClinicFilter] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(10);

  const query = buildQueryString({
    search: debouncedSearch || undefined,
    specialization: specialization || undefined,
    clinic: clinicFilter || undefined,
    status,
    page,
    limit,
  });

  const { state, refresh } = useApiList<Doctor>(`/api/doctors${query}`);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Doctor | null>(null);
  const [statusTarget, setStatusTarget] = React.useState<Doctor | null>(null);
  const [statusLoading, setStatusLoading] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // If the server clamped the requested page (e.g. after the last row on a
  // page was removed), adopt the page it actually served. Render-phase
  // adjustment - no effect involved.
  const [prevServedPage, setPrevServedPage] = React.useState(state.meta.page);
  if (state.meta.page !== prevServedPage) {
    setPrevServedPage(state.meta.page);
    if (state.meta.total > 0 && state.meta.page !== page) {
      setPage(state.meta.page);
    }
  }

  function openCreate() {
    setEditing(null);
    setActionError(null);
    setFormOpen(true);
  }

  function openEdit(doctor: Doctor) {
    setEditing(doctor);
    setActionError(null);
    setFormOpen(true);
  }

  async function handleStatusToggle(doctor: Doctor) {
    if (statusLoading) return;
    setStatusLoading(true);
    setActionError(null);

    try {
      await apiSend(`/api/doctors/${doctor.id}/status`, "PATCH", {
        isActive: !doctor.isActive,
      });
      setStatusTarget(null);
      refresh();
    } catch (err) {
      setStatusTarget(null);
      setActionError(
        err instanceof ApiRequestError
          ? err.message
          : "Unable to update the doctor status.",
      );
    } finally {
      setStatusLoading(false);
    }
  }

  const { data, meta, loading, error } = state;
  const hasActiveFilters =
    debouncedSearch.length > 0 ||
    specialization.length > 0 ||
    clinicFilter.length > 0 ||
    status !== "all";

  const emptyTitle = hasActiveFilters
    ? "No doctors match your filters"
    : "No doctors added yet.";
  const emptyDescription = hasActiveFilters
    ? "Try adjusting the search or filters."
    : "Create the first doctor profile to get started.";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="section-title">Doctors</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Search, filter and manage doctor profiles across clinics.
          </p>
        </div>
        <Button onClick={openCreate}>
          <IconPlus className="size-4" />
          Add doctor
        </Button>
      </div>

      <Card>
        <div className="flex flex-col gap-3 p-4 sm:p-5 lg:flex-row lg:items-end">
          <Input
            label="Search doctors"
            name="doctor-search"
            icon={<IconSearch className="size-4" />}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Name, code, email, phone or specialization"
            containerClassName="lg:max-w-sm"
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:flex-1">
            <Select
              aria-label="Filter by specialization"
              value={specialization}
              onChange={(event) => {
                setSpecialization(event.target.value);
                setPage(1);
              }}
              options={specializationOptions}
            />
            <Select
              aria-label="Filter by clinic"
              value={clinicFilter}
              onChange={(event) => {
                setClinicFilter(event.target.value);
                setPage(1);
              }}
              options={buildClinicOptions(clinicOptions)}
            />
            <Select
              aria-label="Filter by status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              options={STATUS_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
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
        {clinicsError ? (
          <p
            role="status"
            className="border-t border-warning-line bg-warning-soft px-4 py-2.5 text-sm text-warning sm:px-5"
          >
            {clinicsError}
          </p>
        ) : null}

        {/* Desktop table */}
        <div className="hidden md:block">
          <TableShell className="rounded-none border-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Doctor</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Specialization</TableHead>
                  <TableHead>Clinic</TableHead>
                  <TableHead className="text-right">Fee</TableHead>
                  <TableHead>Status</TableHead>
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
                  data.map((doctor) => {
                    const badge = statusBadge(doctor.isActive);
                    return (
                      <TableRow key={doctor.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <EntityAvatar
                              src={doctor.profileImageUrl}
                              alt={doctor.name}
                              fallback={<IconStethoscope className="size-4" />}
                              className="size-9"
                              sizes="36px"
                            />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-ink">
                                {doctor.name}
                              </p>
                              <p className="truncate text-xs text-ink-muted">
                                {doctor.email}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <code className="rounded-md bg-surface-muted px-1.5 py-0.5 text-xs text-ink-muted">
                            {doctor.doctorCode}
                          </code>
                        </TableCell>
                        <TableCell>{doctor.specialization}</TableCell>
                        <TableCell>
                          {doctor.clinic ? (
                            <div className="min-w-0">
                              <p className="truncate text-ink">
                                {doctor.clinic.name}
                              </p>
                              <p className="truncate text-xs text-ink-muted">
                                {doctor.clinic.city ?? doctor.clinic.code}
                              </p>
                            </div>
                          ) : (
                            <span className="text-ink-subtle">Unassigned</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {doctor.consultationFee === null
                            ? "—"
                            : doctor.consultationFee.toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant={badge.variant} dot>
                            {badge.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEdit(doctor)}
                            >
                              <IconPencil className="size-4" />
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setStatusTarget(doctor)}
                            >
                              <IconPower className="size-4" />
                              {doctor.isActive ? "Deactivate" : "Activate"}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <EmptyState
                        icon={IconStethoscope}
                        title={emptyTitle}
                        description={emptyDescription}
                        action={
                          <Button size="sm" onClick={openCreate}>
                            <IconPlus className="size-4" />
                            Add doctor
                          </Button>
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
              {data.map((doctor) => {
                const badge = statusBadge(doctor.isActive);
                return (
                  <li key={doctor.id} className="p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <EntityAvatar
                          src={doctor.profileImageUrl}
                          alt={doctor.name}
                          fallback={<IconStethoscope className="size-5" />}
                          className="size-10"
                          sizes="40px"
                        />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink">
                            {doctor.name}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-ink-muted">
                            {doctor.doctorCode} A� {doctor.specialization}
                          </p>
                        </div>
                      </div>
                      <Badge variant={badge.variant} dot>
                        {badge.label}
                      </Badge>
                    </div>

                    <p className="mt-2 truncate text-sm text-ink-muted">
                      {doctor.clinic ? doctor.clinic.name : "Unassigned clinic"}
                      {doctor.consultationFee !== null
                        ? ` · ${doctor.consultationFee.toLocaleString()}`
                        : ""}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(doctor)}
                      >
                        <IconPencil className="size-4" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setStatusTarget(doctor)}
                      >
                        <IconPower className="size-4" />
                        {doctor.isActive ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="p-4 sm:p-5">
              <EmptyState
                icon={IconStethoscope}
                title={emptyTitle}
                description={emptyDescription}
                action={
                  <Button size="sm" onClick={openCreate}>
                    <IconPlus className="size-4" />
                    Add doctor
                  </Button>
                }
              />
            </div>
          )}
        </div>

        {error ? (
          <div className="p-4 sm:p-5">
            <ErrorState
              title="Unable to load doctors"
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

      <DoctorFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        doctor={editing}
        clinicOptions={clinicOptions}
        clinicsError={clinicsError}
        onSaved={() => {
          onDirectoryChanged();
          refresh();
        }}
      />

      <ConfirmDialog
        open={statusTarget !== null}
        title={
          statusTarget?.isActive ? "Deactivate doctor?" : "Activate doctor?"
        }
        description={
          statusTarget
            ? statusTarget.isActive
              ? `${statusTarget.name} will be marked inactive and hidden from active lists. You can reactivate at any time.`
              : `${statusTarget.name} will be marked active and available in the directory.`
            : ""
        }
        confirmLabel={statusTarget?.isActive ? "Deactivate" : "Activate"}
        tone={statusTarget?.isActive ? "danger" : "primary"}
        loading={statusLoading}
        onCancel={() => setStatusTarget(null)}
        onConfirm={() => {
          if (statusTarget) void handleStatusToggle(statusTarget);
        }}
      />
    </div>
  );
}
