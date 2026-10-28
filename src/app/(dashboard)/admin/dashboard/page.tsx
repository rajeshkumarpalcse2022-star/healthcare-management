import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  IconBadgeCheck,
  IconCalendarCheck,
  IconCreditCard,
  IconFlaskConical,
  IconHome,
  IconShieldCheck,
  IconStethoscope,
  IconUsers,
} from "@/components/icons";
import { PageHeader } from "@/components/shared/page-header";
import { QuickLinks } from "@/components/shared/quick-links";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { ROLES, ROLE_LABELS } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Admin Dashboard",
};

const quickLinks = [
  {
    label: "Doctors & Clinics",
    href: "/doctors",
    icon: IconStethoscope,
    description: "Manage doctor profiles and clinic affiliations.",
  },
  {
    label: "Patients",
    href: "/patients",
    icon: IconUsers,
    description: "Create patients and manage their records.",
  },
  {
    label: "Lab / LIMS",
    href: "/lab",
    icon: IconFlaskConical,
    description: "Laboratory operations and test catalogue.",
  },
  {
    label: "Online Booking",
    href: "/bookings",
    icon: IconCalendarCheck,
    description: "Manage online lab bookings.",
  },
  {
    label: "Home Collection",
    href: "/home-collection",
    icon: IconHome,
    description: "Assign and track home sample pickups.",
  },
  {
    label: "Staff",
    href: "/staff",
    icon: IconBadgeCheck,
    description: "Provision staff accounts and manage roles.",
  },
  {
    label: "Staff Access",
    href: "/admin/users",
    icon: IconShieldCheck,
    description: "Assign laboratory scope to lab and staff accounts.",
  },
  {
    label: "Billing & Payment",
    href: "/billing",
    icon: IconCreditCard,
    description: "Create invoices and record payments.",
  },
] as const;

/** Admin landing page (`/admin/dashboard`). */
export default async function AdminDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (user.role !== ROLES.ADMIN) {
    redirect(getDashboardRouteForRole(user.role));
  }

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title={`Welcome back, ${user.name}`}
        description={`Signed in as ${ROLE_LABELS.ADMIN}. Manage clinics, staff and daily operations.`}
      />

      <QuickLinks links={[...quickLinks]} />

      <Card className="mt-8">
        <CardContent>
          <EmptyState
            title="Recent admin activity"
            description="Operational activity and pending approvals will appear here as modules connect to their data sources."
          />
        </CardContent>
      </Card>
    </>
  );
}
