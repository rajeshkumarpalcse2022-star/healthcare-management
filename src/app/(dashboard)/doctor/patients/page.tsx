import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DoctorPatients } from "@/components/patients/doctor-patients";
import { PageHeader } from "@/components/shared/page-header";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { ROLES } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "My Patients",
};

/**
 * Doctor's patient list (`/doctor/patients`).
 *
 * Deliberately separate from the platform-wide `/patients` directory: a
 * doctor only sees the patients they have personally treated, scoped by the
 * API to their linked, active doctor profile.
 */
export default async function DoctorPatientsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (user.role !== ROLES.DOCTOR) {
    redirect(getDashboardRouteForRole(user.role));
  }

  return (
    <>
      <PageHeader
        eyebrow="Clinical"
        title="My patients"
        description="Patients you have treated so far, with their completed visit history."
        breadcrumbs={[
          { label: "Dashboard", href: "/doctor/dashboard" },
          { label: "My patients" },
        ]}
      />
      <DoctorPatients />
    </>
  );
}
