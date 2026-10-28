import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppointmentsList } from "@/components/appointments/appointments-list";
import { IconCalendarCheck } from "@/components/icons";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { ROLES } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "All Appointments",
};

/**
 * Doctor appointment history (`/doctor/appointments/all`).
 *
 * Same scoped list as the day view, without default date filters - narrow it
 * with the date range, status or reference filters. Kept as a path segment
 * (not a query param) so it works without a Suspense boundary around
 * `useSearchParams`.
 */
export default async function DoctorAppointmentsAllPage() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (user.role !== ROLES.DOCTOR) {
    redirect(getDashboardRouteForRole(user.role));
  }

  return (
    <>
      <PageHeader
        eyebrow="Appointments"
        title="All appointments"
        description="Your full appointment history with status, date and reference filters."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Today's appointments", href: "/doctor/appointments" },
          { label: "All appointments" },
        ]}
        actions={
          <Link href="/doctor/appointments" className="inline-flex">
            <Button variant="outline">
              <IconCalendarCheck className="size-4" />
              Today
            </Button>
          </Link>
        }
      />
      <AppointmentsList variant="doctor" />
    </>
  );
}
