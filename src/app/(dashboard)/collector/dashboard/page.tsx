import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { IconBadgeCheck } from "@/components/icons";
import { CollectorDashboardWidgets } from "@/components/dashboards/collector-dashboard";
import { PageHeader } from "@/components/shared/page-header";
import { QuickLinks } from "@/components/shared/quick-links";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { ROLES, ROLE_LABELS } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Collector Dashboard",
};

const quickLinks = [
  {
    label: "My Assignments",
    href: "/my-assignments",
    icon: IconBadgeCheck,
    description: "Your assigned pickups and their current statuses.",
  },
] as const;

/** Collector landing page (`/collector/dashboard`). */
export default async function CollectorDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (user.role !== ROLES.COLLECTOR) {
    redirect(getDashboardRouteForRole(user.role));
  }

  return (
    <>
      <PageHeader
        eyebrow="Field operations"
        title={`Welcome back, ${user.name}`}
        description={`Signed in as ${ROLE_LABELS.COLLECTOR}. Your pickups and assignments for today.`}
      />

      <QuickLinks links={[...quickLinks]} />

      <CollectorDashboardWidgets />
    </>
  );
}
