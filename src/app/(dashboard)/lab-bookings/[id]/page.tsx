import type { Metadata } from "next";

import { BookingDetail } from "@/components/bookings/booking-detail";
import { PageHeader } from "@/components/shared/page-header";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Booking details",
};

/**
 * Authorised booking detail (`/lab-bookings/[id]`).
 *
 * Shared by patients (their own bookings) and operational roles; the API
 * decides who may see the record and returns a neutral 404 otherwise.
 */
export default async function LabBookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();

  return (
    <>
      <PageHeader
        eyebrow="Diagnostics"
        title="Booking details"
        description="Reference, schedule, booked tests and status history."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Booking details" },
        ]}
      />
      {user ? <BookingDetail bookingId={id} user={user} /> : null}
    </>
  );
}
