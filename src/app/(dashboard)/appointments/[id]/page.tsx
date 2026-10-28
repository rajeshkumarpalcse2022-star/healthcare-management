import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AppointmentDetailPanel } from "@/components/appointments/appointment-detail";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { ROLES } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Appointment Details",
};

const VIEWABLE_ROLES: ReadonlySet<string> = new Set([
  ROLES.PATIENT,
  ROLES.DOCTOR,
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
]);

/**
 * Shared appointment detail (`/appointments/[id]`).
 *
 * Visible to the owning patient, the treating doctor and administrative
 * monitors; any other role is redirected. The API independently returns a
 * neutral 404 when the caller is outside the visibility rule.
 */
export default async function AppointmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (!VIEWABLE_ROLES.has(user.role)) {
    redirect(getDashboardRouteForRole(user.role));
  }

  const backHref =
    user.role === ROLES.PATIENT
      ? "/my-appointments"
      : user.role === ROLES.DOCTOR
        ? "/doctor/appointments"
        : "/appointments";
  const backLabel =
    user.role === ROLES.PATIENT
      ? "My appointments"
      : user.role === ROLES.DOCTOR
        ? "Day view"
        : "All appointments";

  return (
    <>
      <PageHeader
        eyebrow="Appointments"
        title="Appointment details"
        description="Schedule, participants, status timeline and the consultation record."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Appointments", href: backHref },
          { label: "Details" },
        ]}
        actions={
          <Link href={backHref} className="inline-flex">
            <Button variant="outline">{backLabel}</Button>
          </Link>
        }
      />
      <AppointmentDetailPanel
        appointmentId={id}
        role={user.role as "PATIENT" | "DOCTOR" | "SUPER_ADMIN" | "ADMIN"}
      />
    </>
  );
}
