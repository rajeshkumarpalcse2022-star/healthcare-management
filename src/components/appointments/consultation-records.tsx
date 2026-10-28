"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  IconActivity,
  IconCalendarCheck,
  IconDownload,
  IconEye,
  IconSearch,
} from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableShell,
} from "@/components/ui/table";
import { useApiList, useDebouncedSearch } from "@/hooks/use-api-list";
import type { ConsultationListItem } from "@/types/appointment";
import { Pagination } from "../bookings/pagination";
import {
  appointmentTypeLabel,
  buildQueryString,
  formatDateLabel,
  formatDateTime,
} from "./shared";

export interface ConsultationRecordsListProps {
  /** `patient` = released records of self; `doctor` = own consultation records. */
  variant: "patient" | "doctor";
}

/**
 * Consultation record list for patients (their released medical records)
 * and doctors (the records they wrote).
 *
 * `GET /api/consultations` scopes server-side: patients only receive records
 * whose appointment is COMPLETED, doctors only their own profile's records.
 * Rows link to `/medical-records/[appointmentId]`, the shared read view.
 */
export function ConsultationRecordsList({ variant }: ConsultationRecordsListProps) {
  const router = useRouter();
  const { search, setSearch, applied } = useDebouncedSearch();
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(10);

  const query = buildQueryString({ search: applied || undefined, page, limit });
  const { state, refresh } = useApiList<ConsultationListItem>(
    `/api/consultations${query}`,
  );

  const [prevServedPage, setPrevServedPage] = React.useState(state.meta.page);
  if (state.meta.page !== prevServedPage) {
    setPrevServedPage(state.meta.page);
    if (state.meta.total > 0 && state.meta.page !== page) {
      setPage(state.meta.page);
    }
  }

  const { data, meta, loading, error } = state;
  const emptyTitle = applied
    ? "No records match your search"
    : variant === "doctor"
      ? "No consultation records yet"
      : "No medical records yet";
  const emptyDescription = applied
    ? "Try searching by appointment reference."
    : variant === "doctor"
      ? "Complete a consultation to record its notes and prescription."
      : "Consultation records appear here once your appointment is completed.";

  return (
    <Card>
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <Input
          label="Search records"
          name="consultation-search"
          icon={<IconSearch className="size-4" />}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
          placeholder="Appointment reference"
        />
      </div>

      {/* Desktop table */}
      <div className="hidden md:block">
        <TableShell className="rounded-none border-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Consultation</TableHead>
                <TableHead>{variant === "doctor" ? "Patient" : "Doctor"}</TableHead>
                <TableHead>Diagnosis</TableHead>
                <TableHead className="text-right">Rx items</TableHead>
                <TableHead>Updated</TableHead>
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
                data.map((record) => (
                  <TableRow key={record.id}>
                    <TableCell className="font-mono text-xs font-medium text-ink">
                      {record.appointment?.appointmentCode ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="min-w-0">
                        <p className="text-ink">
                          {record.appointment
                            ? formatDateLabel(record.appointment.date)
                            : "—"}
                        </p>
                        <p className="text-xs text-ink-muted">
                          {record.appointment
                            ? `${record.appointment.timeSlot} · ${appointmentTypeLabel(record.appointment.appointmentType)}`
                            : ""}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-40 truncate">
                      {variant === "doctor"
                        ? (record.patient?.name ?? "—")
                        : (record.doctor?.name ?? "—")}
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-ink-muted">
                      {record.diagnosis ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {record.prescriptionCount}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-ink-muted">
                      {formatDateTime(record.updatedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            router.push(
                              `/medical-records/${record.appointment?.id ?? record.id}`,
                            )
                          }
                        >
                          <IconEye className="size-4" />
                          View
                        </Button>
                        <a
                          href={`/api/appointments/${record.appointment?.id ?? record.id}/consultation/document?type=invoice`}
                          className={buttonClasses("ghost", "sm")}
                        >
                          <IconDownload className="size-4" />
                          Invoice
                        </a>
                        <a
                          href={`/api/appointments/${record.appointment?.id ?? record.id}/consultation/document?type=prescription`}
                          className={buttonClasses("ghost", "sm")}
                        >
                          <IconDownload className="size-4" />
                          Rx PDF
                        </a>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyState
                      icon={IconActivity}
                      title={emptyTitle}
                      description={emptyDescription}
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
            {data.map((record) => (
              <li key={record.id} className="p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-semibold text-ink">
                      {record.appointment?.appointmentCode ?? "—"}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">
                      {record.appointment
                        ? formatDateLabel(record.appointment.date)
                        : ""}
                    </p>
                  </div>
                  <Badge variant="neutral" dot>
                    {record.prescriptionCount} Rx
                  </Badge>
                </div>
                <p className="mt-2 truncate text-sm text-ink-muted">
                  {variant === "doctor"
                    ? (record.patient?.name ?? "Patient")
                    : (record.doctor?.name ?? "Doctor")}
                </p>
                <p className="mt-0.5 truncate text-sm text-ink-muted">
                  {record.diagnosis ?? "No diagnosis recorded"}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      router.push(
                        `/medical-records/${record.appointment?.id ?? record.id}`,
                      )
                    }
                  >
                    <IconEye className="size-4" />
                    View record
                  </Button>
                  <a
                    href={`/api/appointments/${record.appointment?.id ?? record.id}/consultation/document?type=invoice`}
                    className={buttonClasses("outline", "sm")}
                  >
                    <IconDownload className="size-4" />
                    Invoice
                  </a>
                  <a
                    href={`/api/appointments/${record.appointment?.id ?? record.id}/consultation/document?type=prescription`}
                    className={buttonClasses("outline", "sm")}
                  >
                    <IconDownload className="size-4" />
                    Rx PDF
                  </a>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="p-4 sm:p-5">
            <EmptyState
              icon={IconCalendarCheck}
              title={emptyTitle}
              description={emptyDescription}
            />
          </div>
        )}
      </div>

      {error ? (
        <div className="p-4 sm:p-5">
          <ErrorState
            title="Unable to load consultation records"
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
  );
}
