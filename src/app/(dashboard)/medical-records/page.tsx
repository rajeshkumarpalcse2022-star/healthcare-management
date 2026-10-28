import type { Metadata } from "next";
import Link from "next/link";

import { ConsultationRecordsList } from "@/components/appointments/consultation-records";
import { IconShieldCheck } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { ROLES } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Medical Records",
};

/**
 * Patient medical records (`/medical-records`).
 *
 * `GET /api/consultations` releases only completed appointments' records to
 * the owning patient; the list never contains another patient's data or
 * unreleased clinical notes.
 */
export default async function MedicalRecordsPage() {
  const user = await getCurrentUser();
  const isPatient = user?.role === ROLES.PATIENT;

  return (
    <>
      <PageHeader
        eyebrow="Appointments"
        title="Medical records"
        description={
          isPatient
            ? "Consultation notes and prescriptions from your completed appointments."
            : "Medical records are available to patient accounts."
        }
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Medical records" },
        ]}
      />

      {isPatient ? (
        <ConsultationRecordsList variant="patient" />
      ) : (
        <Card>
          <CardContent>
            <EmptyState
              icon={IconShieldCheck}
              title="No patient records for this account"
              description="Sign in with a patient account to read its consultation records."
              action={
                <Link href="/my-appointments" className="inline-flex">
                  <Button variant="outline">My appointments</Button>
                </Link>
              }
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
