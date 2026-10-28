import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  IconActivity,
  IconCalendarCheck,
  IconInbox,
  IconSettings,
} from "@/components/icons";
import { DoctorDashboardWidgets } from "@/components/dashboards/doctor-dashboard";
import { PageHeader } from "@/components/shared/page-header";
import { QuickLinks } from "@/components/shared/quick-links";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { ROLES, ROLE_LABELS } from "@/config/roles";
import { connectToDatabase } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Doctor } from "@/models/Doctor";

export const metadata: Metadata = {
  title: "Doctor Dashboard",
};

const quickLinks = [
  {
    label: "Today's Appointments",
    href: "/doctor/appointments",
    icon: IconCalendarCheck,
    description: "Your day view with confirm, start and complete actions.",
  },
  {
    label: "All Appointments",
    href: "/doctor/appointments/all",
    icon: IconInbox,
    description: "Full appointment history with filters.",
  },
  {
    label: "Availability & Schedule",
    href: "/doctor/schedule",
    icon: IconSettings,
    description: "Working days, hours, breaks and leave dates.",
  },
  {
    label: "Consultation Records",
    href: "/doctor/consultations",
    icon: IconActivity,
    description: "Notes and prescriptions you recorded.",
  },
] as const;

/** Doctor landing page (`/doctor/dashboard`). */
export default async function DoctorDashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (user.role !== ROLES.DOCTOR) {
    redirect(getDashboardRouteForRole(user.role));
  }

  // Doctors without a linked, active clinic profile are not approved yet -
  // send them to the pending page instead of the full dashboard.
  let hasActiveProfile = false;
  try {
    await connectToDatabase();
    const doctor = await Doctor.findOne({ userId: user.id, isActive: true });
    hasActiveProfile = Boolean(doctor);
  } catch {
    hasActiveProfile = false;
  }
  if (!hasActiveProfile) {
    redirect("/doctor/pending");
  }

  return (
    <>
      <PageHeader
        eyebrow="Clinical"
        title={`Welcome back, ${user.name}`}
        description={`Signed in as ${ROLE_LABELS.DOCTOR}. Your practice, clinics and bookings in one place.`}
      />

      <QuickLinks links={[...quickLinks]} />

      <DoctorDashboardWidgets />
    </>
  );
}
