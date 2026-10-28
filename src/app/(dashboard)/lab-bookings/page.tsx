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
  title: "Lab Bookings",
};

/**
 * Operational booking management (`/lab-bookings`).
 *
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
        title="Lab bookings"
        description="Review, confirm and manage laboratory bookings across the platform."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Lab bookings" },
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
              title="No access to booking management"
              description="You do not have permission to view lab bookings. Contact your administrator if you believe this is a mistake."
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
