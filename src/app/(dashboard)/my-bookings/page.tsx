import type { Metadata } from "next";
import Link from "next/link";

import { MyBookingsList } from "@/components/bookings/my-bookings-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconCalendarCheck, IconShieldCheck } from "@/components/icons";
import { PageHeader } from "@/components/shared/page-header";
import { ROLES } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "My Bookings",
};

/**
 * The authenticated patient's booking history.
 *
 * The list API hard-scopes every query to the session's own patient record,
 * so this page never passes an identity it could get wrong. Other roles see
 * an explanatory empty state instead of data they are not entitled to.
 */
export default async function MyBookingsPage() {
  const user = await getCurrentUser();
  const isPatient = user?.role === ROLES.PATIENT;

  return (
    <>
      <PageHeader
        eyebrow="Diagnostics"
        title="My bookings"
        description={
          isPatient
            ? "Your lab test bookings - view details, track status or cancel when eligible."
            : "Booking history is available to patient accounts."
        }
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "My bookings" },
        ]}
        actions={
          isPatient ? (
            <Link href="/bookings" className="inline-flex">
              <Button>
                <IconCalendarCheck className="size-4" />
                Book a test
              </Button>
            </Link>
          ) : undefined
        }
      />

      {isPatient ? (
        <MyBookingsList />
      ) : (
        <Card>
          <CardContent>
            <EmptyState
              icon={IconShieldCheck}
              title="No patient bookings for this account"
              description="Sign in with a patient account to see its booking history."
              action={
                <Link href="/bookings" className="inline-flex">
                  <Button variant="outline">Go to online booking</Button>
                </Link>
              }
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
