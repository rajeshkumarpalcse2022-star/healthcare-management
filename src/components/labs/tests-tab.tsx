"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  IconEye,
  IconFlaskConical,
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
import { SPECIMEN_TYPES, TEST_CATEGORIES } from "@/config/labs";
import { apiSend, ApiRequestError } from "@/lib/api/client";
import { useApiList, useDebouncedSearch } from "@/hooks/use-api-list";
import type { LabTest } from "@/types/lab-test";
import type { Laboratory } from "@/types/laboratory";
import { ConfirmDialog } from "./confirm-dialog";
import { LabTestFormModal } from "./test-form-modal";
import { Pagination } from "./pagination";
import {
  buildQueryString,
  formatPrice,
  formatTurnaround,
  STATUS_OPTIONS,
  statusBadge,
} from "./shared";
import { useDepartmentOptions } from "./use-department-options";

const categoryFilterOptions = [
  { value: "", label: "All categories" },
  ...TEST_CATEGORIES.map((value) => ({ value, label: value })),
];

const specimenFilterOptions = [
  { value: "", label: "All specimens" },
  ...SPECIMEN_TYPES.map((value) => ({ value, label: value })),
];

export interface TestsTabProps {
  laboratories: Laboratory[];
  laboratoriesError: string | null;
  managed: boolean;
  onDirectoryChanged: () => void;
}

/**
 * Test catalogue: server-side search, laboratory / department / category /
 * specimen filters, pagination and the view / edit / status actions.
 */
export function TestsTab({
  laboratories,
  laboratoriesError,
  managed,
  onDirectoryChanged,
}: TestsTabProps) {
  const router = useRouter();
  const { search, setSearch, applied: debouncedSearch } =
    useDebouncedSearch();
  const [laboratoryFilter, setLaboratoryFilter] = React.useState("");
  const [departmentFilter, setDepartmentFilter] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [specimen, setSpecimen] = React.useState("");
  const [status, setStatus] = React.useState("all");
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(10);

  const departments = useDepartmentOptions(laboratoryFilter);

  const laboratoryFilterOptions = [
    { value: "", label: "All laboratories" },
    ...laboratories.map((laboratory) => ({
      value: laboratory.id,
      label: `${laboratory.name} (${laboratory.code})`,
    })),
  ];

  const departmentFilterOptions = [
    { value: "", label: "All departments" },
    ...departments.options.map((department) => ({
      value: department.id,
      label: `${department.name} (${department.code})`,
    })),
  ];

  const query = buildQueryString({
    search: debouncedSearch || undefined,
    laboratory: laboratoryFilter || undefined,
    department: departmentFilter || undefined,
    category: category || undefined,
    specimen: specimen || undefined,
    status,
    page,
    limit,
  });

  const { state, refresh } = useApiList<LabTest>(`/api/lab-tests${query}`);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LabTest | null>(null);
  const [statusTarget, setStatusTarget] = React.useState<LabTest | null>(null);
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

  function openEdit(test: LabTest) {
    setEditing(test);
    setActionError(null);
    setFormOpen(true);
  }

  async function handleStatusToggle(test: LabTest) {
    if (statusLoading) return;
    setStatusLoading(true);
    setActionError(null);

    try {
      await apiSend(`/api/lab-tests/${test.id}/status`, "PATCH", {
        isActive: !test.isActive,
      });
      setStatusTarget(null);
      refresh();
    } catch (err) {
      setStatusTarget(null);
      setActionError(
        err instanceof ApiRequestError
          ? err.message
          : "Unable to update the lab test status.",
      );
    } finally {
      setStatusLoading(false);
    }
  }

  const { data, meta, loading, error } = state;
  const hasActiveFilters =
    debouncedSearch.length > 0 ||
    laboratoryFilter.length > 0 ||
    departmentFilter.length > 0 ||
    category.length > 0 ||
    specimen.length > 0 ||
    status !== "all";

  const emptyTitle = hasActiveFilters
    ? "No tests match your filters"
    : "No lab tests added yet.";
  const emptyDescription = hasActiveFilters
    ? "Try adjusting the search or filters."
    : "Create the first catalogue entry to start building the test directory.";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="section-title">Lab tests</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Manage the test catalogue: pricing, turnaround and specimen rules.
          </p>
        </div>
        {managed ? (
          <Button onClick={openCreate}>
            <IconPlus className="size-4" />
            Add test
          </Button>
        ) : null}
      </div>

      <Card>
        <div className="flex flex-col gap-3 p-4 sm:p-5">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Input
              label="Search tests"
              name="test-search"
              icon={<IconSearch className="size-4" />}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="Name or code"
            />
            <Select
              aria-label="Filter by laboratory"
              label="Laboratory"
              value={laboratoryFilter}
              onChange={(event) => {
                setLaboratoryFilter(event.target.value);
                setDepartmentFilter("");
                setPage(1);
              }}
              options={laboratoryFilterOptions}
            />
            <Select
              aria-label="Filter by department"
              label="Department"
              value={departmentFilter}
              onChange={(event) => {
                setDepartmentFilter(event.target.value);
                setPage(1);
              }}
              options={departmentFilterOptions}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Select
              aria-label="Filter by category"
              label="Category"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
                setPage(1);
              }}
              options={categoryFilterOptions}
            />
            <Select
              aria-label="Filter by specimen type"
              label="Specimen"
              value={specimen}
              onChange={(event) => {
                setSpecimen(event.target.value);
                setPage(1);
              }}
              options={specimenFilterOptions}
            />
            <Select
              aria-label="Filter by status"
              label="Status"
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
        {departments.error ? (
          <p
            role="status"
            className="border-t border-warning-line bg-warning-soft px-4 py-2.5 text-sm text-warning sm:px-5"
          >
            {departments.error}
          </p>
        ) : null}

        {/* Desktop table */}
        <div className="hidden md:block">
          <TableShell className="rounded-none border-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Test</TableHead>
                  <TableHead>Laboratory</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead>Turnaround</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && data === null ? (
                  Array.from({ length: 5 }, (_, index) => (
                    <TableRow key={`skeleton-${index}`}>
                      <TableCell colSpan={8}>
                        <div className="skeleton h-4 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : data && data.length > 0 ? (
                  data.map((test) => {
                    const badge = statusBadge(test.isActive);
                    return (
                      <TableRow key={test.id}>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-ink">
                              {test.name}
                            </p>
                            <p className="truncate text-xs text-ink-muted">
                              {test.code} · {test.specimenType}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-36 truncate">
                          {test.laboratory?.name ?? "—"}
                        </TableCell>
                        <TableCell className="max-w-32 truncate">
                          {test.department?.name ?? "—"}
                        </TableCell>
                        <TableCell>
                          <div className="min-w-0">
                            <p className="truncate text-ink">{test.category}</p>
                            <p className="truncate text-xs text-ink-muted">
                              {test.specimenType}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatPrice(test.price)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-ink-muted">
                          {formatTurnaround(test.turnaroundTimeMinutes)}
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
                              onClick={() => router.push(`/lab/tests/${test.id}`)}
                            >
                              <IconEye className="size-4" />
                              View
                            </Button>
                            {managed ? (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => openEdit(test)}
                                >
                                  <IconPencil className="size-4" />
                                  Edit
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setStatusTarget(test)}
                                >
                                  <IconPower className="size-4" />
                                  {test.isActive ? "Deactivate" : "Activate"}
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
                    <TableCell colSpan={8}>
                      <EmptyState
                        icon={IconFlaskConical}
                        title={emptyTitle}
                        description={emptyDescription}
                        action={
                          managed ? (
                            <Button size="sm" onClick={openCreate}>
                              <IconPlus className="size-4" />
                              Add test
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
              {data.map((test) => {
                const badge = statusBadge(test.isActive);
                return (
                  <li key={test.id} className="p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-ink">
                          {test.name}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-ink-muted">
                          {test.code} · {test.category}
                        </p>
                      </div>
                      <Badge variant={badge.variant} dot>
                        {badge.label}
                      </Badge>
                    </div>

                    <p className="mt-2 truncate text-sm text-ink-muted">
                      {test.laboratory?.name ?? "Unassigned"}
                      {test.department ? ` · ${test.department.name}` : ""}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-muted">
                      {test.specimenType} · {formatPrice(test.price)} ·{" "}
                      {formatTurnaround(test.turnaroundTimeMinutes)}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/lab/tests/${test.id}`)}
                      >
                        <IconEye className="size-4" />
                        View
                      </Button>
                      {managed ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openEdit(test)}
                          >
                            <IconPencil className="size-4" />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setStatusTarget(test)}
                          >
                            <IconPower className="size-4" />
                            {test.isActive ? "Deactivate" : "Activate"}
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
                icon={IconFlaskConical}
                title={emptyTitle}
                description={emptyDescription}
                action={
                  managed ? (
                    <Button size="sm" onClick={openCreate}>
                      <IconPlus className="size-4" />
                      Add test
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
              title="Unable to load lab tests"
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

      <LabTestFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        test={editing}
        laboratories={laboratories}
        onSaved={() => {
          refresh();
          onDirectoryChanged();
        }}
      />

      <ConfirmDialog
        open={statusTarget !== null}
        title={statusTarget?.isActive ? "Deactivate test?" : "Activate test?"}
        description={
          statusTarget
            ? statusTarget.isActive
              ? `${statusTarget.name} will be marked inactive and hidden from active lists. Existing configuration and parameters are kept. You can reactivate at any time.`
              : `${statusTarget.name} will be marked active and available in the catalogue.`
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
