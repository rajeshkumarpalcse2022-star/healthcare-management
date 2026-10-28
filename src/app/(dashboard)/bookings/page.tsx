import type { Metadata } from "next";
import Link from "next/link";

import { BookingFlow } from "@/components/bookings/booking-flow";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconShieldCheck } from "@/components/icons";
import { PageHeader } from "@/components/shared/page-header";
import { canCreateBooking } from "@/config/lab-bookings";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Online Booking",
};

/**
 * Patient-facing booking flow (`/bookings` - the module's registered route).
 *
 * The (dashboard) layout has already verified the session; this page reads
 * the same server-side user to decide which surface to render. Roles that
 * cannot self-book get an explicit notice pointing at the management list.
 * All authoritative validation happens in the API routes.
 */
export default async function BookingsPage() {
  const user = await getCurrentUser();

  if (!user || !canCreateBooking(user.role)) {
    return (
      <>
        <PageHeader
          eyebrow="Diagnostics"
          title="Online Booking"
          description="Book lab tests at an active laboratory."
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Online booking" },
          ]}
        />
        <Card>
          <CardContent>
            <EmptyState
              icon={IconShieldCheck}
              title="Booking is available to patients"
              description="Sign in with a patient account to book lab tests, or manage existing bookings from the booking list."
              action={
                <Link href="/lab-bookings" className="inline-flex">
                  <Button variant="outline">Open booking management</Button>
                </Link>
              }
            />
          </CardContent>
        </Card>
      </>
    );
  }

  return <BookingFlow user={user} />;
}
