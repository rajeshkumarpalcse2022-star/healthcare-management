import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DoctorBookingPanel } from "@/components/appointments/doctor-booking";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { ROLES } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Book an Appointment",
};

/**
 * Booking page for one doctor (`/find-a-doctor/[id]`).
 *
 * Patients only - other signed-in roles are sent to their own dashboard.
 * The panel itself loads the public profile and live availability through
 * the directory and availability endpoints.
 */
export default async function DoctorBookingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (user.role !== ROLES.PATIENT) redirect(getDashboardRouteForRole(user.role));

  return (
    <>
      <PageHeader
        eyebrow="Appointments"
        title="Book an appointment"
        description="Choose a date and time, then send a booking request to the doctor."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Find a doctor", href: "/find-a-doctor" },
          { label: "Book" },
        ]}
        actions={
          <Link href="/find-a-doctor" className="inline-flex">
            <Button variant="outline">Back to directory</Button>
          </Link>
        }
      />
      <DoctorBookingPanel doctorId={id} />
    </>
  );
}
