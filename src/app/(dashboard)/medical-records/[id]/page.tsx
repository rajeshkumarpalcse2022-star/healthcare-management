import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { ConsultationView } from "@/components/appointments/consultation-view";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { ROLES } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Consultation Record",
};

/**
 * One consultation record (`/medical-records/[appointmentId]`).
 *
 * Readable by the owning patient (once released) and the treating doctor;
 * administrative roles are redirected away - they have no clinical-note
 * access, which the consultation API also enforces with a 404.
 */
export default async function MedicalRecordDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (user.role !== ROLES.PATIENT && user.role !== ROLES.DOCTOR) {
    redirect(getDashboardRouteForRole(user.role));
  }

  return (
    <>
      <PageHeader
        eyebrow="Appointments"
        title="Consultation record"
        description="Diagnosis, treatment advice and prescription for this consultation."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          {
            label: user.role === ROLES.PATIENT ? "Medical records" : "Consultations",
            href: user.role === ROLES.PATIENT ? "/medical-records" : "/doctor/consultations",
          },
          { label: "Record" },
        ]}
        actions={
          <Link
            href={user.role === ROLES.PATIENT ? "/medical-records" : "/doctor/consultations"}
            className="inline-flex"
          >
            <Button variant="outline">Back to records</Button>
          </Link>
        }
      />
      <ConsultationView
        appointmentId={id}
        viewerRole={user.role === ROLES.PATIENT ? "PATIENT" : "DOCTOR"}
      />
    </>
  );
}
