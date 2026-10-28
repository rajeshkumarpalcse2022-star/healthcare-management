import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  IconCalendarCheck,
  IconFlaskConical,
  IconHome,
  IconUser,
} from "@/components/icons";
import { PatientDashboardWidgets } from "@/components/dashboards/patient-dashboard";
import { PageHeader } from "@/components/shared/page-header";
import { QuickLinks } from "@/components/shared/quick-links";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { ROLES, ROLE_LABELS } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Patient Dashboard",
};

const quickLinks = [
  {
    label: "Book a Test",
    href: "/book-a-test",
    icon: IconFlaskConical,
    description: "Choose a lab visit or a home pickup.",
  },
  {
    label: "My Appointments",
    href: "/my-appointments",
    icon: IconCalendarCheck,
    description: "Your upcoming and past doctor appointments.",
  },
  {
    label: "Home Sample Collection",
    href: "/home-collection",
    icon: IconHome,
    description: "Request a pickup for home sample collection.",
  },
  {
    label: "My Profile",
    href: "/profile",
    icon: IconUser,
    description: "Your account details and contact information.",
  },
] as const;

/** Patient landing page (`/patient/dashboard`). */
export default async function PatientDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (user.role !== ROLES.PATIENT) {
    redirect(getDashboardRouteForRole(user.role));
  }

  return (
    <>
      <PageHeader
        eyebrow="My health"
        title={`Welcome back, ${user.name}`}
        description={`Signed in as ${ROLE_LABELS.PATIENT}. Book tests and track your samples.`}
      />

      <QuickLinks links={[...quickLinks]} />

      <PatientDashboardWidgets />
    </>
  );
}
