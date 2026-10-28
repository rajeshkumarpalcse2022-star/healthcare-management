import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  IconCalendarCheck,
  IconCreditCard,
  IconHome,
  IconPackage,
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
  title: "Staff Dashboard",
};

const quickLinks = [
  {
    label: "Patients",
    href: "/patients",
    icon: IconUsers,
    description: "Browse the patient directory (read-only).",
  },
  {
    label: "Online Booking",
    href: "/lab-bookings",
    icon: IconCalendarCheck,
    description: "Process online lab booking requests.",
  },
  {
    label: "Collection Requests",
    href: "/home-collections/manage",
    icon: IconHome,
    description: "View and track home sample collection requests.",
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

/** Staff landing page (`/staff/dashboard`). */
export default async function StaffDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (user.role !== ROLES.STAFF) {
    redirect(getDashboardRouteForRole(user.role));
  }

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title={`Welcome back, ${user.name}`}
        description={`Signed in as ${ROLE_LABELS.STAFF}. Bookings, collections and front-desk operations.`}
      />

      <QuickLinks links={[...quickLinks]} />

      <Card className="mt-8">
        <CardContent>
          <EmptyState
            title="Today's tasks"
            description="Front-desk tasks and pending requests will appear here once connected to live data."
          />
        </CardContent>
      </Card>
    </>
  );
}
