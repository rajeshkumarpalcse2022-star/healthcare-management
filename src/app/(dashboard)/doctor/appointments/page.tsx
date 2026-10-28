import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppointmentsList } from "@/components/appointments/appointments-list";
import { IconInbox } from "@/components/icons";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { ROLES } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Today's Appointments",
};

/**
 * Doctor day view (`/doctor/appointments`).
 *
 * Opens filtered to the browser's today; the list API scopes every query to
 * the signed-in doctor's own linked profile. Doctors without an active
 * profile are redirected to the approval page first.
 */
export default async function DoctorAppointmentsTodayPage() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (user.role !== ROLES.DOCTOR) {
    redirect(getDashboardRouteForRole(user.role));
  }

  return (
    <>
      <PageHeader
        eyebrow="Appointments"
        title="Today's appointments"
        description="Accepted appointments for today, earliest booking first - start consultations and record outcomes."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Appointments" },
        ]}
        actions={
          <Link href="/doctor/appointments/all" className="inline-flex">
            <Button variant="outline">
              <IconInbox className="size-4" />
              All appointments
            </Button>
          </Link>
        }
      />
      <AppointmentsList variant="doctor" todayQueue />
    </>
  );
}
