import type { Metadata } from "next";
import Link from "next/link";

import { MyAppointmentsList } from "@/components/appointments/my-appointments-list";
import { IconCalendarCheck, IconShieldCheck } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { ROLES } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "My Appointments",
};

/**
 * The authenticated patient's appointment history (`/my-appointments`).
 *
 * The list API hard-scopes every query to the session's own patient, so this
 * page never passes an identity it could get wrong. Other roles see an
 * explanatory empty state instead of data they are not entitled to.
 */
export default async function MyAppointmentsPage() {
  const user = await getCurrentUser();
  const isPatient = user?.role === ROLES.PATIENT;

  return (
    <>
      <PageHeader
        eyebrow="Appointments"
        title="My appointments"
        description={
          isPatient
            ? "Your doctor appointments - review details, reschedule or cancel while eligible."
            : "Appointments are available to patient accounts."
        }
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "My appointments" },
        ]}
        actions={
          isPatient ? (
            <Link href="/find-a-doctor" className="inline-flex">
              <Button>
                <IconCalendarCheck className="size-4" />
                Find a doctor
              </Button>
            </Link>
          ) : undefined
        }
      />

      {isPatient ? (
        <MyAppointmentsList />
      ) : (
        <Card>
          <CardContent>
            <EmptyState
              icon={IconShieldCheck}
              title="No patient appointments for this account"
              description="Sign in with a patient account to manage appointments."
              action={
                <Link href="/find-a-doctor" className="inline-flex">
                  <Button variant="outline">Find a doctor</Button>
                </Link>
              }
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
