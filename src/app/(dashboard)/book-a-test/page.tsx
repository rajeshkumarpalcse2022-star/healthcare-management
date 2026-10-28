import type { Metadata } from "next";
import Link from "next/link";

import {
  IconCalendarCheck,
  IconHome,
  IconShieldCheck,
} from "@/components/icons";
import { PageHeader } from "@/components/shared/page-header";
import { QuickLinks } from "@/components/shared/quick-links";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { canCreateCollection } from "@/config/home-collection";
import { canCreateBooking } from "@/config/lab-bookings";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Book a Test",
};

const bookingChoices = [
  {
    label: "Visit a laboratory",
    href: "/bookings",
    icon: IconCalendarCheck,
    description:
      "Choose a lab, pick a date and time slot, and give your samples at the laboratory.",
  },
  {
    label: "Book a home collection",
    href: "/home-collection",
    icon: IconHome,
    description:
      "Have a certified collector visit your address and collect your samples at home.",
  },
] as const;

/**
 * Patient entry point (`/book-a-test`) that presents both booking flows
 * before committing to one. The actual flows live at their own routes
 * (`/bookings` and `/home-collection`); this page only chooses between
 * them so the sidebar "Book a Test" entry never silently drops patients
 * into a single flow.
 */
export default async function BookATestPage() {
  const user = await getCurrentUser();

  if (!user || !(canCreateBooking(user.role) || canCreateCollection(user.role))) {
    const home = user ? getDashboardRouteForRole(user.role) : LOGIN_ROUTE;
    return (
      <>
        <PageHeader
          eyebrow="Diagnostics"
          title="Book a Test"
          description="Book lab tests with a laboratory visit or a home sample collection."
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Book a test" },
          ]}
        />
        <Card>
          <CardContent>
            <EmptyState
              icon={IconShieldCheck}
              title="Booking is available to patients"
              description="Sign in with a patient account to book lab tests or request a home sample collection."
              action={
                <Link href={home} className="inline-flex">
                  <Button variant="outline">Back to my dashboard</Button>
                </Link>
              }
            />
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Diagnostics"
        title="Book a Test"
        description="Pick how you would like to give your samples - at a laboratory or at home."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Book a test" },
        ]}
      />

      <QuickLinks links={[...bookingChoices]} />
    </>
  );
}
