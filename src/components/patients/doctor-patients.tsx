"use client";

import * as React from "react";

import { IconEye, IconUsers } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
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
import { SkeletonCard } from "@/components/ui/skeleton";
import { Pagination } from "@/components/labs/pagination";
import { useApiList } from "@/hooks/use-api-list";
import type { DoctorPatientSummary } from "@/types/patient";
import { DoctorPatientDetailModal } from "./doctor-patient-detail-modal";

const PAGE_SIZE = 25;

function formatDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString(undefined, { timeZone: "UTC" });
}

/**
 * Doctor's own patient list (`/doctor/patients`).
 *
 * Reads `GET /api/doctor/patients`, which is hard-scoped server-side to the
 * signed-in doctor's linked profile and only returns patients with at least
 * one COMPLETED appointment. The badge shows the total number of unique
 * patients treated to date.
 */
export function DoctorPatients() {
  const [search, setSearch] = React.useState("");
  const [appliedSearch, setAppliedSearch] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [detailsFor, setDetailsFor] =
    React.useState<DoctorPatientSummary | null>(null);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      const next = search.trim();
      if (next === appliedSearch) return;
      setAppliedSearch(next);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search, appliedSearch]);

  const params = new URLSearchParams({
    page: String(page),
    limit: String(PAGE_SIZE),
  });
  if (appliedSearch) params.set("search", appliedSearch);

  const { state, refresh } = useApiList<DoctorPatientSummary>(
    `/api/doctor/patients?${params.toString()}`,
  );

  const patients = state.data ?? [];
  const isEmpty = !state.loading && !state.error && patients.length === 0;

  return (
    <Card className="mt-6">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Patients you have treated</CardTitle>
            <CardDescription>
              Every patient with at least one completed consultation with you,
              newest visit first.
            </CardDescription>
          </div>
          <Badge variant="primary" size="sm">
            {state.meta.total} {state.meta.total === 1 ? "patient" : "patients"}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        <Input
          label="Search patients"
          placeholder="Name, email or phone"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          autoComplete="off"
        />

        {state.error ? (
          <ErrorState
            title="Patients could not be loaded"
            description={state.error}
            onRetry={refresh}
          />
        ) : state.loading && patients.length === 0 ? (
          <SkeletonCard />
        ) : isEmpty ? (
          <EmptyState
            icon={IconUsers}
            title="No treated patients yet"
            description={
              appliedSearch
                ? "No treated patient matches this search."
                : "Patients appear here once you complete a consultation with them."
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="py-2 pr-4 font-medium text-ink-muted">
                    Patient
                  </th>
                  <th className="py-2 pr-4 font-medium text-ink-muted">
                    Completed visits
                  </th>
                  <th className="py-2 pr-4 font-medium text-ink-muted">
                    First visit
                  </th>
                  <th className="py-2 pr-4 font-medium text-ink-muted">
                    Last visit
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
                      <p className="text-xs text-ink-muted">{patient.email}</p>
                      {patient.phone ? (
                        <p className="text-xs text-ink-subtle">
                          {patient.phone}
                        </p>
                      ) : null}
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <Badge variant="success" size="sm">
                          {patient.visits}{" "}
                          {patient.visits === 1 ? "visit" : "visits"}
                        </Badge>
                        <button
                          type="button"
                          onClick={() => setDetailsFor(patient)}
                          aria-label={`View details for ${patient.name}`}
                          title="View patient details"
                          className="inline-flex size-8 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-primary-light hover:text-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                        >
                          <IconEye className="size-4" />
                        </button>
                      </div>
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      {formatDate(patient.firstVisit)}
                    </td>
                    <td className="py-3 pr-4 text-ink-muted">
                      {formatDate(patient.lastVisit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <Pagination
              meta={state.meta}
              onPageChange={(next) => setPage(next)}
              compact
            />
          </div>
        )}
      </CardContent>

      <DoctorPatientDetailModal
        patient={detailsFor}
        onClose={() => setDetailsFor(null)}
      />
    </Card>
  );
}
