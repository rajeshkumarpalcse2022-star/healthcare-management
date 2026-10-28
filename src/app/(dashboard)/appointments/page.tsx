import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppointmentsList } from "@/components/appointments/appointments-list";
import { PageHeader } from "@/components/shared/page-header";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Appointments",
};

/**
 * Administrative appointment monitoring (`/appointments`).
 *
 * Super admin / admin only - the list API applies the same role check and
 * the full monitoring filters (status, type, date range, reference) live in
 * the list component. Clinical consultation notes stay out of this surface.
 */
export default async function AppointmentsAdminPage() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (user.role !== "SUPER_ADMIN" && user.role !== "ADMIN") {
    redirect(getDashboardRouteForRole(user.role));
  }

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Appointments"
        description="Monitor patient appointment requests across all clinics - cancel when policy requires or drill into the timeline."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Appointments" },
        ]}
      />
      <AppointmentsList variant="management" />
    </>
  );
}
