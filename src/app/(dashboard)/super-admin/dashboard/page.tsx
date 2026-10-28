import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  IconBadgeCheck,
  IconCreditCard,
  IconFlaskConical,
  IconHome,
  IconPackage,
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
  title: "Super Admin Dashboard",
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
    label: "Home Collection",
    href: "/home-collection",
    icon: IconHome,
    description: "Oversee home sample collection operations.",
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
  {
    label: "Inventory",
    href: "/inventory",
    icon: IconPackage,
    description: "Stock items, movements and expiry alerts.",
  },
] as const;

/** Super-admin landing page (`/super-admin/dashboard`). */
export default async function SuperAdminDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (user.role !== ROLES.SUPER_ADMIN) {
    redirect(getDashboardRouteForRole(user.role));
  }

  return (
    <>
      <PageHeader
        eyebrow="Platform"
        title={`Welcome back, ${user.name}`}
        description={`Signed in as ${ROLE_LABELS.SUPER_ADMIN}. Full platform oversight across every module.`}
      />

      <QuickLinks links={[...quickLinks]} />

      <Card className="mt-8">
        <CardContent>
          <EmptyState
            title="Recent platform activity"
            description="Live activity and audit events will appear here as modules connect to their data sources."
          />
        </CardContent>
      </Card>
    </>
  );
}
