"use client";

import Link from "next/link";
import * as React from "react";

import { IconCalendarCheck, IconHome, IconInbox } from "@/components/icons";
import { formatDateLabel } from "@/components/home-collection/shared";
import { Button } from "@/components/ui/button";
import { useApiList } from "@/hooks/use-api-list";
import {
  localDateString,
  queueRowStatusBadge,
  sortQueueBySchedule,
} from "@/lib/utils/dashboard-rows";
import type { CollectionRequestSummary } from "@/types/collection-requests";
import { DashboardRow, DashboardWidget } from "./shared-dashboard";

/**
 * Lab manager dashboard data sections (Phase 2).
 *
 * All three widgets read the ops-gated Collection Requests queue
 * (`GET /api/collection-requests`), the only existing read API with both a
 * type filter and a scheduled-date range - so today's lab bookings and
 * today's pickups come from one authorised surface with zero contract
 * changes. Counts are the API's own `meta.total` for the exact filter.
 */
export function LabManagerDashboardWidgets() {
  const [today] = React.useState(() => localDateString());

  const pending = useApiList<CollectionRequestSummary>(
    "/api/collection-requests?status=PENDING&limit=5",
  );
  const todayBookings = useApiList<CollectionRequestSummary>(
    `/api/collection-requests?type=LAB_VISIT&dateFrom=${today}&dateTo=${today}&limit=5`,
  );
  const todayCollections = useApiList<CollectionRequestSummary>(
    `/api/collection-requests?type=HOME_COLLECTION&dateFrom=${today}&dateTo=${today}&limit=5`,
  );

  const bookingRows =
    todayBookings.state.data === null
      ? null
      : sortQueueBySchedule(todayBookings.state.data);
  const collectionRows =
    todayCollections.state.data === null
      ? null
      : sortQueueBySchedule(todayCollections.state.data);

  return (
    <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      <DashboardWidget
        title="Pending review"
        count={pending.state.meta.total}
        link={{
          label: "Open queue",
          href: "/home-collections/manage?view=requests",
        }}
        state={pending.state}
        rows={pending.state.data}
        onRetry={pending.refresh}
        emptyIcon={IconInbox}
        emptyTitle="No pending reviews"
        emptyDescription="New lab-visit and pickup requests will appear here for approval."
        emptyAction={
          <Link href="/home-collections/manage?view=requests" className="inline-flex">
            <Button variant="outline" size="sm">
              Open queue
            </Button>
          </Link>
        }
        renderItem={(request) => {
          const badge = queueRowStatusBadge(request.requestType, request.status);
          return (
            <DashboardRow
              key={`${request.requestType}-${request.id}`}
              href={
                request.requestType === "LAB_VISIT"
                  ? `/lab-bookings/${request.id}`
                  : `/home-collections/${request.id}`
              }
              mono
              title={request.reference}
              meta={`${request.patientName ?? "Patient"} · ${formatDateLabel(request.scheduledDate)} · ${request.timeSlot}`}
              badge={badge.label}
              badgeVariant={badge.variant}
            />
          );
        }}
      />

      <DashboardWidget
        title="Today's lab bookings"
        count={todayBookings.state.meta.total}
        link={{ label: "View all", href: "/lab-bookings" }}
        state={todayBookings.state}
        rows={bookingRows}
        onRetry={todayBookings.refresh}
        emptyIcon={IconCalendarCheck}
        emptyTitle="No bookings for today"
        emptyDescription="Lab visits scheduled for today will appear here."
        renderItem={(request) => {
          const badge = queueRowStatusBadge(request.requestType, request.status);
          return (
            <DashboardRow
              key={`${request.requestType}-${request.id}`}
              href={`/lab-bookings/${request.id}`}
              mono
              title={request.reference}
              meta={`${request.patientName ?? "Patient"} · ${request.timeSlot}`}
              badge={badge.label}
              badgeVariant={badge.variant}
            />
          );
        }}
      />

      <DashboardWidget
        title="Today's home collections"
        count={todayCollections.state.meta.total}
        link={{
          label: "View all",
          href: "/home-collections/manage?view=collections",
        }}
        state={todayCollections.state}
        rows={collectionRows}
        onRetry={todayCollections.refresh}
        emptyIcon={IconHome}
        emptyTitle="No pickups scheduled today"
        emptyDescription="Home collections scheduled for today will appear here."
        renderItem={(request) => {
          const badge = queueRowStatusBadge(request.requestType, request.status);
          return (
            <DashboardRow
              key={`${request.requestType}-${request.id}`}
              href={`/home-collections/${request.id}`}
              mono
              title={request.reference}
              meta={`${request.patientName ?? "Patient"} · ${request.timeSlot} · ${request.collector?.name ?? "No collector"}`}
              badge={badge.label}
              badgeVariant={badge.variant}
            />
          );
        }}
      />
    </div>
  );
}
