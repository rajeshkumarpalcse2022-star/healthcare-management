import type { Metadata } from "next";
import Link from "next/link";

import { LabBookingsList } from "@/components/bookings/lab-bookings-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconShieldCheck } from "@/components/icons";
import { PageHeader } from "@/components/shared/page-header";
import { canViewBookingManagement } from "@/config/lab-bookings";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Lab Visits",
};

/**
 * Lab visit management (`/lab-bookings`).
 *
 * Every lab-visit request - pending, confirmed, rejected and completed - is
 * reviewed from this surface. Home-collection requests have their own section;
 * the merged Collection Requests queue still lists both request types.
 * Visible to super admin, admin, lab manager and staff - the same read
 * policy the lab module already applies. Other roles get an explicit
 * no-access state; the API re-enforces the same rules on every request.
 */
export default async function LabBookingsPage() {
  const user = await getCurrentUser();
  const allowed = user !== null && canViewBookingManagement(user.role);

  return (
    <>
      <PageHeader
        eyebrow="Diagnostics"
        title="Lab visits"
        description="Review and manage lab-visit requests and bookings across the platform."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Lab visits" },
        ]}
        actions={
          allowed ? (
            <Link href="/bookings" className="inline-flex">
              <Button variant="outline">Patient booking flow</Button>
            </Link>
          ) : undefined
        }
      />

      {allowed ? (
        <LabBookingsList role={user.role} />
      ) : (
        <Card>
          <CardContent>
            <EmptyState
              icon={IconShieldCheck}
              title="No access to lab visit management"
              description="You do not have permission to view lab visits. Contact your administrator if you believe this is a mistake."
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
