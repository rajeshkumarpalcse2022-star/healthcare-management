import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  IconCalendarCheck,
  IconCreditCard,
  IconFlaskConical,
  IconHome,
  IconInbox,
} from "@/components/icons";
import { LabManagerDashboardWidgets } from "@/components/dashboards/lab-manager-dashboard";
import { PageHeader } from "@/components/shared/page-header";
import { QuickLinks } from "@/components/shared/quick-links";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { ROLES, ROLE_LABELS } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Lab Manager Dashboard",
};

const quickLinks = [
  {
    label: "Review queue",
    href: "/home-collections/manage?view=requests",
    icon: IconInbox,
    description: "Approve or reject pending lab-visit and pickup requests.",
  },
  {
    label: "Online Bookings",
    href: "/lab-bookings",
    icon: IconCalendarCheck,
    description: "Process and track online lab bookings.",
  },
  {
    label: "Home Collections",
    href: "/home-collections/manage?view=collections",
    icon: IconHome,
    description: "Assign collectors and manage pickup requests.",
  },
  {
    label: "Lab Tests",
    href: "/lab?tab=tests",
    icon: IconFlaskConical,
    description: "Test catalogue, departments and laboratory workflows.",
  },
  {
    label: "Billing & Payment",
    href: "/billing",
    icon: IconCreditCard,
    description: "Create invoices and record payments.",
  },
] as const;

/** Lab manager landing page (`/lab-manager/dashboard`). */
export default async function LabManagerDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (user.role !== ROLES.LAB_MANAGER) {
    redirect(getDashboardRouteForRole(user.role));
  }

  return (
    <>
      <PageHeader
        eyebrow="Diagnostics"
        title={`Welcome back, ${user.name}`}
        description={`Signed in as ${ROLE_LABELS.LAB_MANAGER}. Laboratory operations, bookings and collections at a glance.`}
      />

      <QuickLinks links={[...quickLinks]} />

      <LabManagerDashboardWidgets />
    </>
  );
}
