"use client";

import * as React from "react";

import { IconCalendarCheck, IconInbox } from "@/components/icons";
import {
  appointmentStatusBadgeVariant,
  appointmentStatusLabel,
  appointmentTypeLabel,
} from "@/config/appointments";
import { useApiList } from "@/hooks/use-api-list";
import { localDateString } from "@/lib/utils/dashboard-rows";
import type { AppointmentSummary } from "@/types/appointment";
import { DashboardRow, DashboardWidget } from "./shared-dashboard";

/**
 * Doctor dashboard widgets (Phase 8): today's schedule and the pending
 * requests waiting on a decision.
 *
 * Both read `GET /api/appointments`, hard-scoped server-side to the signed-
 * in doctor's own linked profile - a doctor without an active profile never
 * reaches this dashboard (the page redirects to /doctor/pending first).
 */
export function DoctorDashboardWidgets() {
  const [today] = React.useState(() => localDateString());

  const todays = useApiList<AppointmentSummary>(
    `/api/appointments?dateFrom=${today}&dateTo=${today}&limit=25`,
  );
  const pending = useApiList<AppointmentSummary>(
    "/api/appointments?status=PENDING&limit=10",
  );

  const todayRows =
    todays.state.data === null ? null : todays.state.data.slice(0, 5);
  const pendingRows =
    pending.state.data === null ? null : pending.state.data.slice(0, 5);

  return (
    <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
      <DashboardWidget
        title="Today's appointments"
        link={{ label: "Open day view", href: "/doctor/appointments" }}
        count={todays.state.data?.length ?? null}
        state={todays.state}
        rows={todayRows}
        onRetry={todays.refresh}
        emptyIcon={IconCalendarCheck}
        emptyTitle="No appointments today"
        emptyDescription="Your confirmed and requested appointments for today will appear here."
        renderItem={(appointment) => (
          <DashboardRow
            key={appointment.id}
            href={`/appointments/${appointment.id}`}
            mono
            title={appointment.appointmentCode}
            meta={`${appointment.timeSlot} · ${appointment.patientName ?? "Patient"} · ${appointmentTypeLabel(appointment.appointmentType)}`}
            badge={appointmentStatusLabel(appointment.status)}
            badgeVariant={appointmentStatusBadgeVariant(appointment.status)}
          />
        )}
      />

      <DashboardWidget
        title="Pending requests"
        link={{ label: "Review all", href: "/doctor/appointments/all" }}
        count={pending.state.data?.length ?? null}
        state={pending.state}
        rows={pendingRows}
        onRetry={pending.refresh}
        emptyIcon={IconInbox}
        emptyTitle="No pending requests"
        emptyDescription="New patient requests arrive here for confirmation."
        renderItem={(appointment) => (
          <DashboardRow
            key={appointment.id}
            href={`/appointments/${appointment.id}`}
            mono
            title={appointment.appointmentCode}
            meta={`${appointment.patientName ?? "Patient"} · ${appointment.date} ${appointment.timeSlot}`}
            badge={appointmentStatusLabel(appointment.status)}
            badgeVariant={appointmentStatusBadgeVariant(appointment.status)}
          />
        )}
      />
    </div>
  );
}
