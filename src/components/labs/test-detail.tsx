"use client";

import * as React from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronLeft,
  IconChevronUp,
  IconFlaskConical,
  IconPencil,
  IconPlus,
  IconPower,
  IconRefresh,
  IconTrash,
} from "@/components/icons";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableShell,
} from "@/components/ui/table";
import { canManageLabModule, PARAMETER_DATA_TYPE_LABELS } from "@/config/labs";
import type { Role } from "@/config/roles";
import { apiDelete, apiGet, apiSend, ApiRequestError } from "@/lib/api/client";
import type { ItemResponse, ListResponse } from "@/types/api";
import type { LabTest, LabTestParameter } from "@/types/lab-test";
import type { Laboratory } from "@/types/laboratory";
import { ConfirmDialog } from "./confirm-dialog";
import { LabTestFormModal } from "./test-form-modal";
import { ParameterFormModal } from "./parameter-form-modal";
import {
  formatCritical,
  formatPrice,
  formatReferenceRange,
  formatTurnaround,
  statusBadge,
} from "./shared";

export interface LabTestDetailProps {
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
 * Lab test detail: catalogue metadata plus the ordered parameter list with
 * add / edit / reorder / delete management for lab-capable roles.
 */
export function LabTestDetail({ id, role }: LabTestDetailProps) {
  const router = useRouter();

  const [refreshKey, setRefreshKey] = React.useState(0);
  const requestKey = `test-${id}|${refreshKey}`;

  const [payload, setPayload] = React.useState<{
    requestKey: string;
    test: LabTest | null;
    parameters: LabTestParameter[] | null;
    error: string | null;
  } | null>(null);

  const [laboratories, setLaboratories] = React.useState<Laboratory[]>([]);
  const [laboratoriesError, setLaboratoriesError] = React.useState<
    string | null
  >(null);

  const [testFormOpen, setTestFormOpen] = React.useState(false);
  const [statusOpen, setStatusOpen] = React.useState(false);
  const [statusLoading, setStatusLoading] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const [paramFormOpen, setParamFormOpen] = React.useState(false);
  const [editingParam, setEditingParam] =
    React.useState<LabTestParameter | null>(null);
  const [deletingParam, setDeletingParam] =
    React.useState<LabTestParameter | null>(null);
  const [deleteLoading, setDeleteLoading] = React.useState(false);
  const [reorderingId, setReorderingId] = React.useState<string | null>(null);

  const managed = canManageLabModule(role);

  React.useEffect(() => {
    let cancelled = false;

    Promise.all([
      apiGet<ItemResponse<LabTest>>(`/api/lab-tests/${id}`),
      apiGet<ListResponse<LabTestParameter>>(
        `/api/lab-tests/${id}/parameters?limit=50`,
      ),
    ])
      .then(([testResult, parameterResult]) => {
        if (cancelled) return;
        setPayload({
          requestKey,
          test: testResult.data,
          parameters: parameterResult.data,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPayload({
          requestKey,
          test: null,
          parameters: null,
          error:
            error instanceof ApiRequestError
              ? error.message
              : "Unable to load the lab test right now.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [id, requestKey]);

  React.useEffect(() => {
    if (!managed) return;
    let cancelled = false;

    apiGet<ListResponse<Laboratory>>("/api/laboratories?status=all&limit=50")
      .then((result) => {
        if (cancelled) return;
        setLaboratories(result.data);
        setLaboratoriesError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLaboratories([]);
        setLaboratoriesError(
          error instanceof ApiRequestError
            ? error.message
            : "Unable to load the laboratory list.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [managed]);

  const loading = payload === null || payload.requestKey !== requestKey;
  const test = payload?.test ?? null;
  const parameters = payload?.parameters ?? [];
  const error = payload?.error ?? null;

  async function handleStatusToggle() {
    if (!test || statusLoading) return;
    setStatusLoading(true);
    setActionError(null);

    try {
      const result = await apiSend<ItemResponse<LabTest>>(
        `/api/lab-tests/${test.id}/status`,
        "PATCH",
        { isActive: !test.isActive },
      );
      setPayload((current) => ({
        requestKey,
        test: result.data,
        parameters: current?.parameters ?? parameters,
        error: null,
      }));
      setStatusOpen(false);
    } catch (err) {
      setStatusOpen(false);
      setActionError(
        err instanceof ApiRequestError
          ? err.message
          : "Unable to update the lab test status.",
      );
    } finally {
      setStatusLoading(false);
    }
  }

  /** Moves a parameter one position up or down via the reorder contract. */
  async function handleReorder(
    parameter: LabTestParameter,
    direction: "up" | "down",
  ) {
    if (reorderingId) return;
    setReorderingId(parameter.id);
    setActionError(null);

    try {
      await apiSend<ItemResponse<LabTestParameter>>(
        `/api/lab-test-parameters/${parameter.id}`,
        "PATCH",
        {
          displayOrder:
            direction === "up"
              ? parameter.displayOrder - 1
              : parameter.displayOrder + 1,
        },
      );
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setActionError(
        err instanceof ApiRequestError
          ? err.message
          : "Unable to reorder the parameter.",
      );
    } finally {
      setReorderingId(null);
    }
  }

  async function handleDeleteParameter() {
    if (!deletingParam || deleteLoading) return;
    setDeleteLoading(true);
    setActionError(null);

    try {
      await apiDelete<ItemResponse<{ id: string; deleted: boolean }>>(
        `/api/lab-test-parameters/${deletingParam.id}`,
      );
      setDeletingParam(null);
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setDeletingParam(null);
      setActionError(
        err instanceof ApiRequestError
          ? err.message
          : "Unable to delete the parameter.",
      );
    } finally {
      setDeleteLoading(false);
    }
  }

  if (loading) {
    return (
      <>
        <PageHeader
          eyebrow="Laboratory"
          title="Lab test"
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Lab", href: "/lab" },
            { label: "Test details" },
          ]}
        />
        <Card>
          <CardContent className="p-5 sm:p-6">
            <div className="flex items-center gap-4">
              <Skeleton className="size-14 rounded-xl" />
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
        <Card className="mt-6">
          <CardContent className="p-5 sm:p-6">
            <Skeleton className="h-4 w-40" />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </>
    );
  }

  if (error || !test) {
    return (
      <>
        <PageHeader
          eyebrow="Laboratory"
          title="Lab test"
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Lab", href: "/lab" },
            { label: "Test details" },
          ]}
          actions={
            <Link
              href="/lab"
              className="inline-flex h-9 items-center gap-1.5 rounded-control border border-border bg-transparent px-3 text-sm font-medium text-ink shadow-sm transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              <IconChevronLeft className="size-4" />
              Back to lab
            </Link>
          }
        />
        <ErrorState
          title="Unable to load this lab test"
          description={error ?? "Lab test not found."}
          onRetry={() => setRefreshKey((value) => value + 1)}
        />
      </>
    );
  }

  const badge = statusBadge(test.isActive);
  const parameterCount = parameters.length;

  return (
    <>
      <PageHeader
        eyebrow="Laboratory"
        title={test.name}
        description={`${test.category} · ${test.specimenType}`}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Lab", href: "/lab" },
          { label: test.name },
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
                  onClick={() => setTestFormOpen(true)}
                >
                  <IconPencil className="size-4" />
                  Edit
                </Button>
                <Button
                  variant={test.isActive ? "danger" : "primary"}
                  size="sm"
                  onClick={() => setStatusOpen(true)}
                >
                  <IconPower className="size-4" />
                  {test.isActive ? "Deactivate" : "Activate"}
                </Button>
              </>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={badge.variant} dot>
          {badge.label}
        </Badge>
        <Badge variant="primary" size="sm">
          {test.code}
        </Badge>
        <Badge variant="neutral" size="sm">
          {parameterCount} {parameterCount === 1 ? "parameter" : "parameters"}
        </Badge>
      </div>

      {actionError ? (
        <p
          role="alert"
          className="mt-4 rounded-control border border-danger-line bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
        >
          {actionError}
        </p>
      ) : null}
      {laboratoriesError ? (
        <p
          role="status"
          className="mt-4 rounded-control border border-warning-line bg-warning-soft px-3.5 py-2.5 text-sm text-warning"
        >
          {laboratoriesError}
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
                  <IconFlaskConical className="size-5" />
                </span>
                <CardTitle>Test information</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border">
                <DetailRow label="Test name" value={test.name} />
                <DetailRow label="Test code" value={test.code} />
                <DetailRow
                  label="Laboratory"
                  value={
                    test.laboratory
                      ? `${test.laboratory.name} (${test.laboratory.code})`
                      : "—"
                  }
                />
                <DetailRow
                  label="Department"
                  value={
                    test.department
                      ? `${test.department.name} (${test.department.code})`
                      : "—"
                  }
                />
                <DetailRow label="Category" value={test.category} />
                <DetailRow label="Specimen type" value={test.specimenType} />
                <DetailRow
                  label="Methodology"
                  value={test.methodology ?? "—"}
                />
                <DetailRow
                  label="Turnaround time"
                  value={formatTurnaround(test.turnaroundTimeMinutes)}
                />
                <DetailRow
                  label="Price"
                  value={formatPrice(test.price)}
                />
              </dl>

              {test.description ? (
                <div className="mt-5 rounded-control border border-border bg-surface-muted p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-ink-subtle">
                    Description
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                    {test.description}
                  </p>
                </div>
              ) : null}

              {test.preparationInstructions ? (
                <div className="mt-4 rounded-control border border-border bg-surface-muted p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-ink-subtle">
                    Preparation instructions
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                    {test.preparationInstructions}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Record</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="divide-y divide-border">
                <DetailRow label="Status" value={badge.label} />
                <DetailRow label="Parameters" value={String(parameterCount)} />
                <DetailRow
                  label="Created"
                  value={new Date(test.createdAt).toLocaleString()}
                />
                <DetailRow
                  label="Last updated"
                  value={new Date(test.updatedAt).toLocaleString()}
                />
              </dl>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-6">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Parameters</CardTitle>
                <p className="mt-1 text-sm text-ink-muted">
                  The ordered values reported with this test. Use the arrows to
                  control report order.
                </p>
              </div>
              {managed ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingParam(null);
                    setActionError(null);
                    setParamFormOpen(true);
                  }}
                >
                  <IconPlus className="size-4" />
                  Add parameter
                </Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="p-0 sm:p-0">
            {parameterCount === 0 ? (
              <div className="p-5">
                <EmptyState
                  icon={IconAlertTriangle}
                  title="No parameters defined yet."
                  description="Add the measurable values this test reports, such as Hemoglobin or White Blood Cell count."
                  action={
                    managed ? (
                      <Button
                        size="sm"
                        onClick={() => {
                          setEditingParam(null);
                          setActionError(null);
                          setParamFormOpen(true);
                        }}
                      >
                        <IconPlus className="size-4" />
                        Add parameter
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              <>
                {/* Desktop table */}
                <div className="hidden md:block">
                  <TableShell className="rounded-none border-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-14">#</TableHead>
                          <TableHead>Parameter</TableHead>
                          <TableHead>Data type</TableHead>
                          <TableHead>Unit</TableHead>
                          <TableHead>Reference range</TableHead>
                          <TableHead>Critical</TableHead>
                          <TableHead>Required</TableHead>
                          <TableHead className="text-right">
                            Actions
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {parameters.map((parameter, index) => (
                          <TableRow key={parameter.id}>
                            <TableCell className="tabular-nums text-ink-muted">
                              {parameter.displayOrder}
                            </TableCell>
                            <TableCell>
                              <div className="min-w-0">
                                <p className="truncate font-medium text-ink">
                                  {parameter.name}
                                </p>
                                <p className="truncate text-xs text-ink-muted">
                                  {parameter.code}
                                </p>
                              </div>
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {PARAMETER_DATA_TYPE_LABELS[parameter.dataType]}
                            </TableCell>
                            <TableCell className="text-ink-muted">
                              {parameter.unit ?? "—"}
                            </TableCell>
                            <TableCell className="max-w-40 truncate">
                              {formatReferenceRange(
                                parameter.referenceRange,
                                parameter.unit,
                              )}
                            </TableCell>
                            <TableCell className="max-w-32 truncate text-ink-muted">
                              {formatCritical(
                                parameter.criticalLow,
                                parameter.criticalHigh,
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  parameter.isRequired ? "primary" : "neutral"
                                }
                                size="sm"
                              >
                                {parameter.isRequired ? "Required" : "Optional"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center justify-end gap-1">
                                {managed ? (
                                  <>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      aria-label={`Move ${parameter.name} up`}
                                      disabled={
                                        index === 0 ||
                                        reorderingId !== null
                                      }
                                      loading={reorderingId === parameter.id}
                                      onClick={() =>
                                        void handleReorder(parameter, "up")
                                      }
                                    >
                                      <IconChevronUp className="size-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      aria-label={`Move ${parameter.name} down`}
                                      disabled={
                                        index === parameterCount - 1 ||
                                        reorderingId !== null
                                      }
                                      onClick={() =>
                                        void handleReorder(parameter, "down")
                                      }
                                    >
                                      <IconChevronDown className="size-4" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => {
                                        setEditingParam(parameter);
                                        setActionError(null);
                                        setParamFormOpen(true);
                                      }}
                                    >
                                      <IconPencil className="size-4" />
                                      Edit
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() =>
                                        setDeletingParam(parameter)
                                      }
                                    >
                                      <IconTrash className="size-4" />
                                      Delete
                                    </Button>
                                  </>
                                ) : (
                                  <span className="px-2 text-sm text-ink-muted">
                                    —
                                  </span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableShell>
                </div>

                {/* Mobile cards */}
                <ul className="divide-y divide-border md:hidden">
                  {parameters.map((parameter, index) => (
                    <li key={parameter.id} className="p-4 sm:p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-ink">
                            {parameter.displayOrder}. {parameter.name}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-ink-muted">
                            {parameter.code} ·{" "}
                            {PARAMETER_DATA_TYPE_LABELS[parameter.dataType]}
                            {parameter.unit ? ` · ${parameter.unit}` : ""}
                          </p>
                        </div>
                        <Badge
                          variant={parameter.isRequired ? "primary" : "neutral"}
                          size="sm"
                        >
                          {parameter.isRequired ? "Required" : "Optional"}
                        </Badge>
                      </div>

                      <p className="mt-2 text-sm text-ink-muted">
                        Reference:{" "}
                        {formatReferenceRange(
                          parameter.referenceRange,
                          parameter.unit,
                        )}
                      </p>
                      <p className="mt-0.5 text-sm text-ink-muted">
                        Critical:{" "}
                        {formatCritical(
                          parameter.criticalLow,
                          parameter.criticalHigh,
                        )}
                      </p>

                      {managed ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`Move ${parameter.name} up`}
                            disabled={index === 0 || reorderingId !== null}
                            loading={reorderingId === parameter.id}
                            onClick={() => void handleReorder(parameter, "up")}
                          >
                            <IconChevronUp className="size-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={`Move ${parameter.name} down`}
                            disabled={
                              index === parameterCount - 1 ||
                              reorderingId !== null
                            }
                            onClick={() =>
                              void handleReorder(parameter, "down")
                            }
                          >
                            <IconChevronDown className="size-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setEditingParam(parameter);
                              setActionError(null);
                              setParamFormOpen(true);
                            }}
                          >
                            <IconPencil className="size-4" />
                            Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeletingParam(parameter)}
                          >
                            <IconTrash className="size-4" />
                            Delete
                          </Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <Button
          variant="link"
          size="sm"
          onClick={() => router.push("/lab")}
        >
          <IconChevronLeft className="size-4" />
          Back to lab tests
        </Button>
      </div>

      <LabTestFormModal
        open={testFormOpen}
        onClose={() => setTestFormOpen(false)}
        test={test}
        laboratories={laboratories}
        onSaved={(saved) => {
          setPayload((current) => ({
            requestKey,
            test: saved,
            parameters: current?.parameters ?? parameters,
            error: null,
          }));
          setRefreshKey((value) => value + 1);
        }}
      />

      <ParameterFormModal
        open={paramFormOpen}
        onClose={() => setParamFormOpen(false)}
        labTestId={test.id}
        parameter={editingParam}
        onSaved={() => setRefreshKey((value) => value + 1)}
      />

      <ConfirmDialog
        open={statusOpen}
        title={test.isActive ? "Deactivate test?" : "Activate test?"}
        description={
          test.isActive
            ? `${test.name} will be marked inactive and hidden from active lists. Its parameters are kept. You can reactivate at any time.`
            : `${test.name} will be marked active and available in the catalogue.`
        }
        confirmLabel={test.isActive ? "Deactivate" : "Activate"}
        tone={test.isActive ? "danger" : "primary"}
        loading={statusLoading}
        onCancel={() => setStatusOpen(false)}
        onConfirm={() => void handleStatusToggle()}
      />

      <ConfirmDialog
        open={deletingParam !== null}
        title="Delete parameter?"
        description={
          deletingParam
            ? `${deletingParam.name} will be permanently removed from this test. Remaining parameters will be renumbered. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete parameter"
        tone="danger"
        loading={deleteLoading}
        onCancel={() => setDeletingParam(null)}
        onConfirm={() => void handleDeleteParameter()}
      />
    </>
  );
}
