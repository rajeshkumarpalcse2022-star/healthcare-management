"use client";

import * as React from "react";

import {
  IconBuilding,
  IconEye,
  IconPencil,
  IconPlus,
  IconPower,
  IconSearch,
} from "@/components/icons";
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
import type { Laboratory } from "@/types/laboratory";
import { ConfirmDialog } from "./confirm-dialog";
import { LaboratoryDetailsModal } from "./laboratory-details-modal";
import { LaboratoryFormModal } from "./laboratory-form-modal";
import { Pagination } from "./pagination";
import { buildQueryString, STATUS_OPTIONS, statusBadge } from "./shared";

export interface LaboratoriesTabProps {
  /** False for STAFF / DOCTOR - read-only browsing, no write actions. */
  managed: boolean;
  onDirectoryChanged: () => void;
}

/**
 * Laboratory directory: server-side search, status filtering, pagination and
 * the create / edit / status actions available to lab management roles.
 */
export function LaboratoriesTab({
  managed,
  onDirectoryChanged,
}: LaboratoriesTabProps) {
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

  const { state, refresh } = useApiList<Laboratory>(`/api/laboratories${query}`);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Laboratory | null>(null);
  const [detailsFor, setDetailsFor] = React.useState<Laboratory | null>(null);
  const [statusTarget, setStatusTarget] = React.useState<Laboratory | null>(
    null,
  );
  const [statusLoading, setStatusLoading] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // If the server clamped the requested page, adopt the page it actually
  // served. Render-phase adjustment - no effect involved.
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

  function openEdit(laboratory: Laboratory) {
    setEditing(laboratory);
    setActionError(null);
    setFormOpen(true);
  }

  async function handleStatusToggle(laboratory: Laboratory) {
    if (statusLoading) return;
    setStatusLoading(true);
    setActionError(null);

    try {
      await apiSend(`/api/laboratories/${laboratory.id}/status`, "PATCH", {
        isActive: !laboratory.isActive,
      });
      setStatusTarget(null);
      refresh();
      onDirectoryChanged();
    } catch (err) {
      setStatusTarget(null);
      setActionError(
        err instanceof ApiRequestError
          ? err.message
          : "Unable to update the laboratory status.",
      );
    } finally {
      setStatusLoading(false);
    }
  }

  const { data, meta, loading, error } = state;
  const hasActiveFilters = debouncedSearch.length > 0 || status !== "all";

  const emptyTitle = hasActiveFilters
    ? "No laboratories match your filters"
    : "No laboratories added yet.";
  const emptyDescription = hasActiveFilters
    ? "Try adjusting the search or filters."
    : "Create the first laboratory to start building the LIMS directory.";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="section-title">Laboratories</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Manage laboratories, their contact details and accreditation.
          </p>
        </div>
        {managed ? (
          <Button onClick={openCreate}>
            <IconPlus className="size-4" />
            Add laboratory
          </Button>
        ) : null}
      </div>

      <Card>
        <div className="flex flex-col gap-3 p-4 sm:p-5 lg:flex-row lg:items-end">
          <Input
            label="Search laboratories"
            name="laboratory-search"
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
                  <TableHead>Laboratory</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Accreditation</TableHead>
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
                  data.map((laboratory) => {
                    const badge = statusBadge(laboratory.isActive);
                    return (
                      <TableRow key={laboratory.id}>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink">
                              {laboratory.name}
                            </p>
                            <p className="truncate text-xs text-ink-muted">
                              {laboratory.email ?? laboratory.phone ?? "—"}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <code className="rounded-md bg-surface-muted px-1.5 py-0.5 text-xs text-ink-muted">
                            {laboratory.code}
                          </code>
                        </TableCell>
                        <TableCell>{laboratory.city ?? "—"}</TableCell>
                        <TableCell className="text-ink-muted">
                          {laboratory.accreditation ?? "—"}
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
                              onClick={() => setDetailsFor(laboratory)}
                            >
                              <IconEye className="size-4" />
                              Details
                            </Button>
                            {managed ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openEdit(laboratory)}
                                >
                                  <IconPencil className="size-4" />
                                  Edit
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setStatusTarget(laboratory)}
                                >
                                  <IconPower className="size-4" />
                                  {laboratory.isActive
                                    ? "Deactivate"
                                    : "Activate"}
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
                    <TableCell colSpan={6}>
                      <EmptyState
                        icon={IconBuilding}
                        title={emptyTitle}
                        description={emptyDescription}
                        action={
                          managed ? (
                            <Button size="sm" onClick={openCreate}>
                              <IconPlus className="size-4" />
                              Add laboratory
                            </Button>
                          ) : undefined
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
              {data.map((laboratory) => {
                const badge = statusBadge(laboratory.isActive);
                return (
                  <li key={laboratory.id} className="p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">
                          {laboratory.name}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-ink-muted">
                          {laboratory.code}
                          {laboratory.city ? ` · ${laboratory.city}` : ""}
                        </p>
                      </div>
                      <Badge variant={badge.variant} dot>
                        {badge.label}
                      </Badge>
                    </div>

                    {laboratory.accreditation ? (
                      <p className="mt-2 truncate text-sm text-ink-muted">
                        {laboratory.accreditation}
                      </p>
                    ) : null}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDetailsFor(laboratory)}
                      >
                        <IconEye className="size-4" />
                        Details
                      </Button>
                      {managed ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEdit(laboratory)}
                          >
                            <IconPencil className="size-4" />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setStatusTarget(laboratory)}
                          >
                            <IconPower className="size-4" />
                            {laboratory.isActive ? "Deactivate" : "Activate"}
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
                icon={IconBuilding}
                title={emptyTitle}
                description={emptyDescription}
                action={
                  managed ? (
                    <Button size="sm" onClick={openCreate}>
                      <IconPlus className="size-4" />
                      Add laboratory
                    </Button>
                  ) : undefined
                }
              />
            </div>
          )}
        </div>

        {error ? (
          <div className="p-4 sm:p-5">
            <ErrorState
              title="Unable to load laboratories"
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

      <LaboratoryFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        laboratory={editing}
        onSaved={() => {
          onDirectoryChanged();
          refresh();
        }}
      />

      <LaboratoryDetailsModal
        open={detailsFor !== null}
        onClose={() => setDetailsFor(null)}
        laboratory={detailsFor}
      />

      <ConfirmDialog
        open={statusTarget !== null}
        title={
          statusTarget?.isActive
            ? "Deactivate laboratory?"
            : "Activate laboratory?"
        }
        description={
          statusTarget
            ? statusTarget.isActive
              ? `${statusTarget.name} will be marked inactive. Departments and tests inside it will no longer accept new entries until it is reactivated. You can reactivate at any time.`
              : `${statusTarget.name} will be marked active and available for department and test management.`
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
