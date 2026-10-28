import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ConsultationRecordsList } from "@/components/appointments/consultation-records";
import { IconActivity } from "@/components/icons";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { ROLES } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Consultation Records",
};

/**
 * Doctor's consultation records (`/doctor/consultations`).
 *
 * `GET /api/consultations` returns only records written under the signed-in
 * doctor's own profile - other doctors' clinical notes are unreachable.
 */
export default async function DoctorConsultationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (user.role !== ROLES.DOCTOR) {
    redirect(getDashboardRouteForRole(user.role));
  }

  return (
    <>
      <PageHeader
        eyebrow="Appointments"
        title="Consultation records"
        description="Notes, diagnoses and prescriptions you recorded for completed consultations."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Consultation records" },
        ]}
        actions={
          <Link href="/doctor/appointments" className="inline-flex">
            <Button variant="outline">
              <IconActivity className="size-4" />
              Day view
            </Button>
          </Link>
        }
      />
      <ConsultationRecordsList variant="doctor" />
    </>
  );
}
