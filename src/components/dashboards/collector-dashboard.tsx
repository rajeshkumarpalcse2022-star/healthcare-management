"use client";

import * as React from "react";

import { IconBadgeCheck, IconHome } from "@/components/icons";
import {
  collectionStatusBadge,
  formatDateLabel,
} from "@/components/home-collection/shared";
import { Badge } from "@/components/ui/badge";
import { useApiList } from "@/hooks/use-api-list";
import {
  localDateString,
  pickUpcomingCollections,
} from "@/lib/utils/dashboard-rows";
import type { HomeCollectionSummary } from "@/types/home-collection";
import { DashboardRow, DashboardWidget } from "./shared-dashboard";

/**
 * Collector dashboard data sections (Phase 2).
 *
 * Every query hits `GET /api/home-collections`, which hard-scopes the list
 * server-side to `assignedCollectorId = session user` - a collector can only
 * ever see their own pickups. Actions are deliberately not duplicated here:
 * the existing assignment board on `/my-assignments` owns the workflow
 * transitions, while this card reports real statuses (including the exact
 * "awaiting acceptance" count from `meta.total`).
 */
export function CollectorDashboardWidgets() {
  const [today] = React.useState(() => localDateString());

  const todaysPickups = useApiList<HomeCollectionSummary>(
    `/api/home-collections?dateFrom=${today}&dateTo=${today}&limit=6`,
  );
  const assignments = useApiList<HomeCollectionSummary>(
    "/api/home-collections?limit=8",
  );
  const awaiting = useApiList<HomeCollectionSummary>(
    "/api/home-collections?status=ASSIGNED&limit=1",
  );

  const todayRows =
    todaysPickups.state.data === null
      ? null
      : pickUpcomingCollections(todaysPickups.state.data, today, 6);

  const awaitingCount =
    awaiting.state.loading || awaiting.state.error
      ? null
      : awaiting.state.meta.total;

  return (
    <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
      <DashboardWidget
        title="Today's pickups"
        count={todaysPickups.state.meta.total}
        link={{ label: "View all", href: "/my-assignments" }}
        state={todaysPickups.state}
        rows={todayRows}
        onRetry={todaysPickups.refresh}
        emptyIcon={IconHome}
        emptyTitle="No pickups today"
        emptyDescription="Pickups assigned to you for today will appear here."
        renderItem={(collection) => {
          const badge = collectionStatusBadge(collection.status);
          return (
            <DashboardRow
              key={collection.id}
              href={`/home-collections/${collection.id}`}
              mono
              title={collection.collectionCode}
              meta={`${collection.timeSlot} · ${collection.laboratory?.name ?? "Laboratory"}`}
              badge={badge.label}
              badgeVariant={badge.variant}
            />
          );
        }}
      />

      <DashboardWidget
        title="My assignments"
        count={assignments.state.meta.total}
        badges={
          awaitingCount !== null && awaitingCount > 0 ? (
            <Badge variant="warning" size="sm">
              {awaitingCount} awaiting acceptance
            </Badge>
          ) : undefined
        }
        link={{ label: "View all", href: "/my-assignments" }}
        state={assignments.state}
        rows={assignments.state.data}
        onRetry={assignments.refresh}
        emptyIcon={IconBadgeCheck}
        emptyTitle="No assignments yet"
        emptyDescription="Pickups assigned to you will appear here with their current status."
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
