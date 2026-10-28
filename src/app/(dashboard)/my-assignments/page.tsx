import type { Metadata } from "next";

import { MyCollectionsList } from "@/components/home-collection/my-collections-list";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconShieldCheck } from "@/components/icons";
import { PageHeader } from "@/components/shared/page-header";
import { canViewAssignments } from "@/config/home-collection";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "My Assignments",
};

/**
 * Collector assignment board (`/my-assignments`).
 *
 * Only COLLECTOR accounts see their pickups; the list API hard-scopes every
 * query to the session's collector id, so changing the URL or filters can
 * never surface another collector's assignments. Other roles get an explicit
 * no-access state.
 */
export default async function MyAssignmentsPage() {
  const user = await getCurrentUser();
  const allowed = user !== null && canViewAssignments(user.role);

  return (
    <>
      <PageHeader
        eyebrow="Diagnostics"
        title="My assignments"
        description={
          allowed
            ? "Pickups assigned to you - start the route, mark arrival, record collection or flag a failed pickup."
            : "Assignment boards are available to collector accounts."
        }
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "My assignments" },
        ]}
      />

      {allowed ? (
        <MyCollectionsList mode="collector" />
      ) : (
        <Card>
          <CardContent>
            <EmptyState
              icon={IconShieldCheck}
              title="No assignments for this account"
              description="Sign in with a collector account to see assigned pickups."
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
