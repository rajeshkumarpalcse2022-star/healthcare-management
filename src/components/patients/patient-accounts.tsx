"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/labs/pagination";
import { Select } from "@/components/ui/select";
import { SkeletonCard } from "@/components/ui/skeleton";
import { ApiRequestError, apiGet, apiSend } from "@/lib/api/client";
import type { ListMeta, ListResponse } from "@/types/api";
import type { PatientDto } from "@/lib/patient/dto";

import { PatientFormModal } from "./patient-form-modal";
import { PatientProfileModal } from "./patient-profile-modal";

const PAGE_SIZE = 25;

const STATUS_FILTER_OPTIONS = [
  { value: "", label: "All records" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Deactivated" },
];

const EMPTY_META: ListMeta = {
  page: 1,
  limit: PAGE_SIZE,
  total: 0,
  totalPages: 1,
  hasPrev: false,
  hasNext: false,
};

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString();
}

interface PatientAccountsProps {
  /** ADMIN / SUPER_ADMIN may create patients and edit/activate records. */
  canManage: boolean;
}

/**
 * Patient directory for `/patients` (LAB_MANAGER / STAFF / ADMIN /
 * SUPER_ADMIN): search across name/email/phone, record-status filter and
 * paginated listing. LAB_MANAGER/STAFF are read-only on this surface by
 * approved design; ADMIN/SUPER_ADMIN additionally get create, edit and
 * activate/deactivate actions.
 */
export function PatientAccounts({ canManage }: PatientAccountsProps) {
  const router = useRouter();
  const [patients, setPatients] = React.useState<PatientDto[]>([]);
  const [meta, setMeta] = React.useState<ListMeta>(EMPTY_META);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [appliedSearch, setAppliedSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("");
  const [page, setPage] = React.useState(1);

  const [createOpen, setCreateOpen] = React.useState(false);
  /** Patient being edited via the demographics dialog (`null` = closed). */
  const [editing, setEditing] = React.useState<PatientDto | null>(null);
  const [reloadTick, setReloadTick] = React.useState(0);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      const next = search.trim();
      if (next === appliedSearch) return;
      setAppliedSearch(next);
      setPage(1);
      setLoading(true);
      setLoadError("");
    }, 300);
    return () => clearTimeout(timer);
  }, [search, appliedSearch]);

  React.useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
    });
    if (appliedSearch) params.set("search", appliedSearch);
    if (statusFilter) params.set("status", statusFilter);

    apiGet<ListResponse<PatientDto>>(`/api/patients?${params.toString()}`)
      .then((result) => {
        if (cancelled) return;
        setPatients(result.data);
        setMeta(result.meta);
        setLoadError("");
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof ApiRequestError
            ? error.message
            : "Patients could not be loaded.",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [appliedSearch, statusFilter, page, reloadTick]);

  const retryLoad = () => {
    setLoading(true);
    setLoadError("");
    setReloadTick((tick) => tick + 1);
  };

  const handleSaved = (saved: PatientDto) => {
    const exists = patients.some((entry) => entry.id === saved.id);
    if (exists) {
      setPatients((list) =>
        list.map((entry) => (entry.id === saved.id ? saved : entry)),
      );
    } else {
      setLoading(true);
      setReloadTick((tick) => tick + 1);
    }
  };

  const toggleStatus = async (patient: PatientDto) => {
    const nextActive = !patient.profile.isActive;
    try {
      const result = await apiSend<{ data: PatientDto }>(
        `/api/patients/${patient.id}/status`,
        "PATCH",
        { isActive: nextActive },
      );
      handleSaved(result.data);
    } catch {
      // Re-load so the row reflects the authoritative server state.
      retryLoad();
    }
  };

  return (
    <>
      <Card className="mt-6">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle>Patients</CardTitle>
              <CardDescription>
                The platform-wide patient directory. Records without a profile
                yet still appear here - open one to add demographics.
              </CardDescription>
            </div>
            {canManage ? (
              <Button type="button" onClick={() => setCreateOpen(true)}>
                Add patient
              </Button>
            ) : null}
          </div>
        </CardHeader>

        <CardContent className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Search patients"
              placeholder="Name, email or phone"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              autoComplete="off"
            />
            <Select
              label="Filter by record status"
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
                setLoading(true);
                setLoadError("");
              }}
              options={STATUS_FILTER_OPTIONS}
            />
          </div>

          {loadError ? (
            <ErrorState
              title="Patients could not be loaded"
              description={loadError}
              onRetry={retryLoad}
            />
          ) : loading && patients.length === 0 ? (
            <SkeletonCard />
          ) : patients.length === 0 ? (
            <EmptyState
              title="No patients found"
              description={
                appliedSearch || statusFilter
                  ? "Try a different search or status filter."
                  : canManage
                    ? "Add the first patient to get started."
                    : "No patient accounts exist yet."
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="py-2 pr-4 font-medium text-ink-muted">
                      Patient
                    </th>
                    <th className="py-2 pr-4 font-medium text-ink-muted">
                      Record
                    </th>
                    <th className="py-2 pr-4 font-medium text-ink-muted">
                      Blood group
                    </th>
                    <th className="py-2 pr-4 font-medium text-ink-muted">
                      Created
                    </th>
                    <th className="py-2 pr-4 font-medium text-ink-muted">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {patients.map((patient) => (
                    <tr
                      key={patient.id}
                      className="border-b border-border/60 last:border-b-0"
                    >
                      <td className="py-3 pr-4">
                        <p className="font-medium text-ink">{patient.name}</p>
                        <p className="text-xs text-ink-muted">
                          {patient.email}
                        </p>
                        {patient.phone ? (
                          <p className="text-xs text-ink-subtle">
                            {patient.phone}
                          </p>
                        ) : null}
                      </td>
                      <td className="py-3 pr-4">
                        <Badge
                          variant={
                            patient.profile.isActive ? "success" : "warning"
                          }
                          size="sm"
                        >
                          {patient.profile.isActive
                            ? "Active"
                            : "Deactivated"}
                        </Badge>
                        {patient.profile.hasProfile ? null : (
                          <p className="mt-1 text-xs text-ink-subtle">
                            No profile yet
                          </p>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-ink-muted">
                        {patient.profile.bloodGroup
                          ? patient.profile.bloodGroup.replace("_", "")
                          : "—"}
                      </td>
                      <td className="py-3 pr-4 text-ink-muted">
                        {formatDate(patient.createdAt)}
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <span className="inline-flex flex-wrap justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              router.push(`/patients/${patient.id}`)
                            }
                          >
                            View
                          </Button>
                          {canManage ? (
                            <>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setEditing(patient)}
                              >
                                {patient.profile.hasProfile
                                  ? "Edit"
                                  : "Add profile"}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => toggleStatus(patient)}
                              >
                                {patient.profile.isActive
                                  ? "Deactivate"
                                  : "Activate"}
                              </Button>
                            </>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <Pagination
                meta={meta}
                onPageChange={(next) => {
                  setPage(next);
                  setLoading(true);
                  setLoadError("");
                }}
                compact
              />
            </div>
          )}
        </CardContent>
      </Card>

      <PatientFormModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={handleSaved}
      />
      <PatientProfileModal
        patient={editing}
        onClose={() => setEditing(null)}
        onSaved={handleSaved}
      />
    </>
  );
}
