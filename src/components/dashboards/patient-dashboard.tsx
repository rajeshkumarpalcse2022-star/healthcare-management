"use client";

import Link from "next/link";
import * as React from "react";

import {
  IconCalendarCheck,
  IconHome,
  IconStethoscope,
} from "@/components/icons";
import { statusBadge } from "@/components/bookings/shared";
import {
  collectionStatusBadge,
  formatDateLabel,
} from "@/components/home-collection/shared";
import { appointmentStatusBadgeVariant, appointmentStatusLabel } from "@/config/appointments";
import { Button } from "@/components/ui/button";
import { useApiList } from "@/hooks/use-api-list";
import {
  localDateString,
  pickUpcomingAppointments,
  pickUpcomingBookings,
  pickUpcomingCollections,
} from "@/lib/utils/dashboard-rows";
import type { HomeCollectionSummary } from "@/types/home-collection";
import type { LabBookingSummary } from "@/types/lab-booking";
import type { AppointmentSummary } from "@/types/appointment";
import { DashboardRow, DashboardWidget } from "./shared-dashboard";

/**
 * Patient dashboard data sections (Phase 2).
 *
 * Every widget reads the existing session-scoped APIs - the appointments and
 * bookings lists are hard-scoped to the signed-in patient, the collections
 * list to their own requests - so nothing here can surface another patient's
 * data. Today is computed in the browser (decision D4) and the
 * upcoming-windows are the documented `limit` client filters (decision D1/A1).
 */
export function PatientDashboardWidgets() {
  const [today] = React.useState(() => localDateString());

  const appointments = useApiList<AppointmentSummary>(
    "/api/appointments?limit=25",
  );
  const bookings = useApiList<LabBookingSummary>(
    "/api/lab-bookings?limit=25",
  );
  const collections = useApiList<HomeCollectionSummary>(
    `/api/home-collections?dateFrom=${today}&limit=6`,
  );

  const upcomingAppointments =
    appointments.state.data === null
      ? null
      : pickUpcomingAppointments(appointments.state.data, today, 4);

  const upcoming =
    bookings.state.data === null
      ? null
      : pickUpcomingBookings(bookings.state.data, today, 4);

  const pickups =
    collections.state.data === null
      ? null
      : pickUpcomingCollections(collections.state.data, today, 4);

  return (
    <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
      <DashboardWidget
        title="Upcoming appointments"
        link={{ label: "View all", href: "/my-appointments" }}
        state={appointments.state}
        rows={upcomingAppointments}
        onRetry={appointments.refresh}
        emptyIcon={IconCalendarCheck}
        emptyTitle="No upcoming appointments"
        emptyDescription="Find a doctor and book a consultation to see it here."
        emptyAction={
          <Link href="/find-a-doctor" className="inline-flex">
            <Button variant="outline" size="sm">
              Find a doctor
            </Button>
          </Link>
        }
        renderItem={(appointment) => (
          <DashboardRow
            key={appointment.id}
            href={`/appointments/${appointment.id}`}
            mono
            title={appointment.appointmentCode}
            meta={`${formatDateLabel(appointment.date)} · ${appointment.timeSlot} · ${appointment.doctor?.name ?? "Doctor"}`}
            badge={appointmentStatusLabel(appointment.status)}
            badgeVariant={appointmentStatusBadgeVariant(appointment.status)}
          />
        )}
      />

      <DashboardWidget
        title="Lab bookings"
        link={{ label: "View all", href: "/my-bookings" }}
        state={bookings.state}
        rows={upcoming}
        onRetry={bookings.refresh}
        emptyIcon={IconStethoscope}
        emptyTitle="No upcoming lab bookings"
        emptyDescription="Book a lab test and your visit will appear here once scheduled."
        emptyAction={
          <Link href="/book-a-test" className="inline-flex">
            <Button variant="outline" size="sm">
              Book a test
            </Button>
          </Link>
        }
        renderItem={(booking) => {
          const badge = statusBadge(booking.status);
          return (
            <DashboardRow
              key={booking.id}
              href={`/lab-bookings/${booking.id}`}
              mono
              title={booking.bookingCode}
              meta={`${formatDateLabel(booking.bookingDate)} · ${booking.timeSlot} · ${booking.laboratory?.name ?? "Laboratory"}`}
              badge={badge.label}
              badgeVariant={badge.variant}
            />
          );
        }}
      />

      <DashboardWidget
        title="Home collection requests"
        link={{ label: "View all", href: "/my-collections" }}
        state={collections.state}
        rows={pickups}
        onRetry={collections.refresh}
        emptyIcon={IconHome}
        emptyTitle="No pickups scheduled"
        emptyDescription="Request a home sample collection and follow its progress here."
        emptyAction={
          <Link href="/home-collection" className="inline-flex">
            <Button variant="outline" size="sm">
              Book a pickup
            </Button>
          </Link>
        }
        renderItem={(collection) => {
          const badge = collectionStatusBadge(collection.status);
          return (
            <DashboardRow
              key={collection.id}
              href={`/home-collections/${collection.id}`}
              mono
              title={collection.collectionCode}
              meta={`${formatDateLabel(collection.scheduledDate)} · ${collection.timeSlot} · ${collection.laboratory?.name ?? "Laboratory"}`}
              badge={badge.label}
              badgeVariant={badge.variant}
            />
          );
        }}
      />
    </div>
  );
}
