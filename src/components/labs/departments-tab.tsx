"use client";

import * as React from "react";

import {
  IconLayers,
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
import type { LabDepartment } from "@/types/lab-department";
import type { Laboratory } from "@/types/laboratory";
import { ConfirmDialog } from "./confirm-dialog";
import { DepartmentFormModal } from "./department-form-modal";
import { Pagination } from "./pagination";
import { buildQueryString, STATUS_OPTIONS, statusBadge } from "./shared";

export interface DepartmentsTabProps {
  /** Every laboratory (including inactive) as picker options. */
  laboratories: Laboratory[];
  laboratoriesError: string | null;
  managed: boolean;
  /** Shown when no laboratory exists yet - jumps to the laboratories tab. */
  onGoToLaboratories: () => void;
  onDirectoryChanged: () => void;
}

/**
 * Departments of one selected laboratory: server-side search, status
 * filtering, pagination and the create / edit / status actions available to
 * lab management roles. The owning laboratory is always visible so the
 * context is never ambiguous.
 */
export function DepartmentsTab({
  laboratories,
  laboratoriesError,
  managed,
  onGoToLaboratories,
  onDirectoryChanged,
}: DepartmentsTabProps) {
  const labOptions = React.useMemo(
    () =>
      laboratories.map((laboratory) => ({
        value: laboratory.id,
        label: laboratory.isActive
          ? `${laboratory.name} (${laboratory.code})`
          : `${laboratory.name} (${laboratory.code}) - inactive`,
      })),
    [laboratories],
  );

  const [selectedLabId, setSelectedLabId] = React.useState("");

  // Adopt the first available laboratory as the default selection using a
  // render-phase adjustment - no effect involved.
  if (selectedLabId === "" && laboratories.length > 0) {
    setSelectedLabId(laboratories[0].id);
  }

  const selectedLab =
    laboratories.find((laboratory) => laboratory.id === selectedLabId) ?? null;

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

  const { state, refresh } = useApiList<LabDepartment>(
    selectedLabId
      ? `/api/laboratories/${selectedLabId}/departments${query}`
      : "",
  );

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LabDepartment | null>(null);
  const [statusTarget, setStatusTarget] = React.useState<LabDepartment | null>(
    null,
  );
  const [statusLoading, setStatusLoading] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  // Adopt a server-clamped page during render (see laboratories tab).
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

  function openEdit(department: LabDepartment) {
    setEditing(department);
    setActionError(null);
    setFormOpen(true);
  }

  async function handleStatusToggle(department: LabDepartment) {
    if (statusLoading) return;
    setStatusLoading(true);
    setActionError(null);

    try {
      await apiSend(`/api/lab-departments/${department.id}/status`, "PATCH", {
        isActive: !department.isActive,
      });
      setStatusTarget(null);
      refresh();
    } catch (err) {
      setStatusTarget(null);
      setActionError(
        err instanceof ApiRequestError
          ? err.message
          : "Unable to update the department status.",
      );
    } finally {
      setStatusLoading(false);
    }
  }

  const { data, meta, loading, error } = state;
  const hasActiveFilters = debouncedSearch.length > 0 || status !== "all";

  const emptyTitle = hasActiveFilters
    ? "No departments match your filters"
    : "No departments added yet.";
  const emptyDescription = hasActiveFilters
    ? "Try adjusting the search or filters."
    : "Create the first department for this laboratory, e.g. Hematology.";

  if (laboratories.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="section-title">Departments</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Organise each laboratory into functional departments.
            </p>
          </div>
        </div>

        <Card>
          {laboratoriesError ? (
            <p
              role="alert"
              className="border-b border-danger-line bg-danger-soft px-4 py-2.5 text-sm text-danger sm:px-5"
            >
              {laboratoriesError}
            </p>
          ) : null}
          <div className="p-4 sm:p-5">
            <EmptyState
              icon={IconLayers}
              title="Create a laboratory first"
              description="Departments live inside laboratories. Add a laboratory before creating departments."
              action={
                managed ? (
                  <Button size="sm" onClick={onGoToLaboratories}>
                    Go to laboratories
                  </Button>
                ) : undefined
              }
            />
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
            <h2 className="section-title">Departments</h2>
            <p className="mt-1 text-sm text-ink-muted">
              {selectedLab
                ? `Departments inside ${selectedLab.name}.`
                : "Select a laboratory to manage its departments."}
            </p>
          </div>
        {managed ? (
          <Button onClick={openCreate} disabled={!selectedLab}>
            <IconPlus className="size-4" />
            Add department
          </Button>
        ) : null}
      </div>

      <Card>
        <div className="flex flex-col gap-3 p-4 sm:p-5 lg:flex-row lg:items-end">
          <Select
            aria-label="Select laboratory"
            label="Laboratory"
            value={selectedLabId}
            onChange={(event) => {
              setSelectedLabId(event.target.value);
              setPage(1);
            }}
            options={labOptions}
            containerClassName="lg:max-w-sm"
          />

          <Input
            label="Search departments"
            name="department-search"
            icon={<IconSearch className="size-4" />}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Name, code or description"
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
        {laboratoriesError ? (
          <p
            role="status"
            className="border-t border-warning-line bg-warning-soft px-4 py-2.5 text-sm text-warning sm:px-5"
          >
            {laboratoriesError}
          </p>
        ) : null}

        {/* Desktop table */}
        <div className="hidden md:block">
          <TableShell className="rounded-none border-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && data === null ? (
                  Array.from({ length: 4 }, (_, index) => (
                    <TableRow key={`skeleton-${index}`}>
                      <TableCell colSpan={4}>
                        <div className="skeleton h-4 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : data && data.length > 0 ? (
                  data.map((department) => {
                    const badge = statusBadge(department.isActive);
                    return (
                      <TableRow key={department.id}>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink">
                              {department.name}
                            </p>
                            <p className="truncate text-xs text-ink-muted">
                              {department.description ?? "No description"}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <code className="rounded-md bg-surface-muted px-1.5 py-0.5 text-xs text-ink-muted">
                            {department.code}
                          </code>
                        </TableCell>
                        <TableCell>
                          <Badge variant={badge.variant} dot>
                            {badge.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1.5">
                            {managed ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openEdit(department)}
                                >
                                  <IconPencil className="size-4" />
                                  Edit
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setStatusTarget(department)}
                                >
                                  <IconPower className="size-4" />
                                  {department.isActive
                                    ? "Deactivate"
                                    : "Activate"}
                                </Button>
                              </>
                            ) : (
                              <span className="text-sm text-ink-subtle">
                                View only
                              </span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <EmptyState
                        icon={IconLayers}
                        title={emptyTitle}
                        description={emptyDescription}
                        action={
                          managed && selectedLab ? (
                            <Button size="sm" onClick={openCreate}>
                              <IconPlus className="size-4" />
                              Add department
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
              {data.map((department) => {
                const badge = statusBadge(department.isActive);
                return (
                  <li key={department.id} className="p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">
                          {department.name}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-ink-muted">
                          {department.code}
                        </p>
                      </div>
                      <Badge variant={badge.variant} dot>
                        {badge.label}
                      </Badge>
                    </div>

                    {department.description ? (
                      <p className="mt-2 line-clamp-2 text-sm text-ink-muted">
                        {department.description}
                      </p>
                    ) : null}

                    {managed ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openEdit(department)}
                        >
                          <IconPencil className="size-4" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setStatusTarget(department)}
                        >
                          <IconPower className="size-4" />
                          {department.isActive ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="p-4 sm:p-5">
              <EmptyState
                icon={IconLayers}
                title={emptyTitle}
                description={emptyDescription}
                action={
                  managed && selectedLab ? (
                    <Button size="sm" onClick={openCreate}>
                      <IconPlus className="size-4" />
                      Add department
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
              title="Unable to load departments"
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

      <DepartmentFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        laboratory={
          selectedLab
            ? { id: selectedLab.id, name: selectedLab.name, code: selectedLab.code }
            : null
        }
        department={editing}
        onSaved={() => {
          refresh();
          onDirectoryChanged();
        }}
      />

      <ConfirmDialog
        open={statusTarget !== null}
        title={
          statusTarget?.isActive
            ? "Deactivate department?"
            : "Activate department?"
        }
        description={
          statusTarget
            ? statusTarget.isActive
              ? `${statusTarget.name} will be marked inactive and will not accept new tests until reactivated. You can reactivate at any time.`
              : `${statusTarget.name} will be marked active and available for test assignment.`
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
