import type { Metadata } from "next";
import Link from "next/link";

import { FindDoctorList } from "@/components/appointments/find-doctor";
import { IconShieldCheck, IconStethoscope } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { ROLES } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Find a Doctor",
};

/**
 * Doctor directory for patients (`/find-a-doctor`).
 *
 * Only the public-safe directory projection is rendered - no contact or
 * registration fields exist on the client at all.
 */
export default async function FindDoctorPage() {
  const user = await getCurrentUser();
  const isPatient = user?.role === ROLES.PATIENT;

  return (
    <>
      <PageHeader
        eyebrow="Appointments"
        title="Find a doctor"
        description={
          isPatient
            ? "Browse available doctors and request an in-person or online consultation."
            : "The doctor directory is available to patient accounts."
        }
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Find a doctor" },
        ]}
      />

      {isPatient ? (
        <FindDoctorList />
      ) : (
        <Card>
          <CardContent>
            <EmptyState
              icon={IconShieldCheck}
              title="Directory restricted to patients"
              description="Sign in with a patient account to browse doctors and book."
              action={
                <Link href="/my-appointments" className="inline-flex">
                  <Button variant="outline">
                    <IconStethoscope className="size-4" />
                    My appointments
                  </Button>
                </Link>
              }
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
