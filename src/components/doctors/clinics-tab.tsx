"use client";

import * as React from "react";

import {
  IconBuilding,
  IconMapPin,
  IconPencil,
  IconPlus,
  IconPower,
  IconSearch,
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
import { apiSend, ApiRequestError } from "@/lib/api/client";
import { useApiList, useDebouncedSearch } from "@/hooks/use-api-list";
import { googleMapsUrl, hasMapLocation } from "@/lib/utils/location";
import type { Clinic } from "@/types/clinic";
import { ClinicFormModal } from "./clinic-form-modal";
import { ConfirmDialog } from "./confirm-dialog";
import { Pagination } from "./pagination";
import { buildQueryString, STATUS_OPTIONS, statusBadge } from "./shared";

export interface ClinicsTabProps {
  /** Called after a save so the module can refresh clinic option lists. */
  onDirectoryChanged: () => void;
}

/**
 * Clinic directory: server-side search, status filter, pagination and the
 * create / edit / status actions available to admin roles.
 */
export function ClinicsTab({ onDirectoryChanged }: ClinicsTabProps) {
  const { search, setSearch, applied: debouncedSearch } =
    useDebouncedSearch();
  const [status, setStatus] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(10);

  const query = buildQueryString({
    search: debouncedSearch || undefined,
    status,
    page,
    limit,
  });

  const { state, refresh } = useApiList<Clinic>(`/api/clinics${query}`);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Clinic | null>(null);
  const [statusTarget, setStatusTarget] = React.useState<Clinic | null>(null);
  const [statusLoading, setStatusLoading] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // Adopt the page the server actually served when it clamps an out-of-range
  // request. Render-phase adjustment - no effect involved.
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

  function openEdit(clinic: Clinic) {
    setEditing(clinic);
    setActionError(null);
    setFormOpen(true);
  }

  async function handleStatusToggle(clinic: Clinic) {
    if (statusLoading) return;
    setStatusLoading(true);
    setActionError(null);

    try {
      await apiSend(`/api/clinics/${clinic.id}/status`, "PATCH", {
        isActive: !clinic.isActive,
      });
      setStatusTarget(null);
      refresh();
    } catch (err) {
      setStatusTarget(null);
      setActionError(
        err instanceof ApiRequestError
          ? err.message
          : "Unable to update the clinic status.",
      );
    } finally {
      setStatusLoading(false);
    }
  }

  const { data, meta, loading, error } = state;
  const hasActiveFilters = debouncedSearch.length > 0 || status !== "all";
  const emptyTitle = hasActiveFilters
    ? "No clinics match your filters"
    : "No clinics added yet.";
  const emptyDescription = hasActiveFilters
    ? "Try adjusting the search or status filter."
    : "Create the first clinic to get started.";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="section-title">Clinics</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Manage clinic locations, contact details and availability.
          </p>
        </div>
        <Button onClick={openCreate}>
          <IconPlus className="size-4" />
          Add clinic
        </Button>
      </div>

      <Card>
        <div className="flex flex-col gap-3 p-4 sm:p-5 lg:flex-row lg:items-end">
          <Input
            label="Search clinics"
            name="clinic-search"
            icon={<IconSearch className="size-4" />}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Name, code or city"
            containerClassName="lg:max-w-sm"
          />

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex-1">
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

        {/* Desktop table */}
        <div className="hidden md:block">
          <TableShell className="rounded-none border-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Clinic</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && data === null ? (
                  Array.from({ length: 5 }, (_, index) => (
                    <TableRow key={`skeleton-${index}`}>
                      <TableCell colSpan={6}>
                        <div className="skeleton h-4 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : data && data.length > 0 ? (
                  data.map((clinic) => {
                    const badge = statusBadge(clinic.isActive);
                    const location = [clinic.city, clinic.state]
                      .filter(Boolean)
                      .join(", ");
                    return (
                      <TableRow key={clinic.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <EntityAvatar
                              src={clinic.imageUrl}
                              alt={clinic.name}
                              fallback={<IconBuilding className="size-4" />}
                              className="size-9"
                              sizes="36px"
                            />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-ink">
                                {clinic.name}
                              </p>
                              {clinic.email ? (
                                <p className="truncate text-xs text-ink-muted">
                                  {clinic.email}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <code className="rounded-md bg-surface-muted px-1.5 py-0.5 text-xs text-ink-muted">
                            {clinic.code}
                          </code>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {location || (
                              <span className="text-ink-subtle">Not set</span>
                            )}
                            {hasMapLocation(clinic) ? (
                              <a
                                href={googleMapsUrl(
                                  clinic.latitude,
                                  clinic.longitude,
                                )}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`Open ${clinic.name} in Google Maps`}
                                className="text-primary hover:text-primary-hover"
                              >
                                <IconMapPin className="size-3.5" />
                              </a>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {clinic.phone ?? (
                            <span className="text-ink-subtle">—</span>
                          )}
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
                              onClick={() => openEdit(clinic)}
                            >
                              <IconPencil className="size-4" />
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setStatusTarget(clinic)}
                            >
                              <IconPower className="size-4" />
                              {clinic.isActive ? "Deactivate" : "Activate"}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <EmptyState
                        icon={IconBuilding}
                        title={emptyTitle}
                        description={emptyDescription}
                        action={
                          <Button size="sm" onClick={openCreate}>
                            <IconPlus className="size-4" />
                            Add clinic
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
              {data.map((clinic) => {
                const badge = statusBadge(clinic.isActive);
                const location = [clinic.city, clinic.state]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <li key={clinic.id} className="p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <EntityAvatar
                          src={clinic.imageUrl}
                          alt={clinic.name}
                          fallback={<IconBuilding className="size-5" />}
                          className="size-10"
                          sizes="40px"
                        />
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink">
                            {clinic.name}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-ink-muted">
                            {clinic.code}
                            {location ? ` A� ${location}` : ""}
                          </p>
                        </div>
                      </div>
                      <Badge variant={badge.variant} dot>
                        {badge.label}
                      </Badge>
                    </div>

                    {clinic.phone ? (
                      <p className="mt-2 truncate text-sm text-ink-muted">
                        {clinic.phone}
                      </p>
                    ) : null}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(clinic)}
                      >
                        <IconPencil className="size-4" />
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setStatusTarget(clinic)}
                      >
                        <IconPower className="size-4" />
                        {clinic.isActive ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="p-4 sm:p-5">
              <EmptyState
                icon={IconBuilding}
                title={emptyTitle}
                description={emptyDescription}
                action={
                  <Button size="sm" onClick={openCreate}>
                    <IconPlus className="size-4" />
                    Add clinic
                  </Button>
                }
              />
            </div>
          )}
        </div>

        {error ? (
          <div className="p-4 sm:p-5">
            <ErrorState
              title="Unable to load clinics"
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

      <ClinicFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        clinic={editing}
        onSaved={() => {
          onDirectoryChanged();
          refresh();
        }}
      />

      <ConfirmDialog
        open={statusTarget !== null}
        title={
          statusTarget?.isActive ? "Deactivate clinic?" : "Activate clinic?"
        }
        description={
          statusTarget
            ? statusTarget.isActive
              ? `${statusTarget.name} will be marked inactive and hidden from active lists. New doctors cannot be assigned to an inactive clinic.`
              : `${statusTarget.name} will be marked active and available for doctor assignments.`
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
