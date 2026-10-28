import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { IconInfo, IconShieldCheck } from "@/components/icons";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { LOGIN_ROUTE } from "@/config/auth";
import { ROLES } from "@/config/roles";
import { connectToDatabase } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Doctor } from "@/models/Doctor";

export const metadata: Metadata = {
  title: "Account Pending Approval",
};

/**
 * Doctor approval-pending page (`/doctor/pending`).
 *
 * Shown to DOCTOR accounts that do not yet have a linked, active clinic
 * profile. The doctor dashboard redirects here automatically; once an
 * administrator links and activates the profile, the full dashboard unlocks.
 */
export default async function DoctorPendingPage() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (user.role !== ROLES.DOCTOR) {
    redirect("/dashboard");
  }

  // Already approved - send to the real dashboard.
  try {
    await connectToDatabase();
    const doctor = await Doctor.findOne({ userId: user.id, isActive: true });
    if (doctor) redirect("/doctor/dashboard");
  } catch {
    // Fall through and show the pending state on query failure.
  }

  return (
    <>
      <PageHeader
        eyebrow="Account status"
        title="Awaiting clinic approval"
        description="Your doctor account is active, but full dashboard access requires a linked clinic profile."
      />

      <Card>
        <CardContent>
          <EmptyState
            icon={IconInfo}
            title="Pending clinic affiliation"
            description="An administrator must link your account to a clinic and activate your doctor profile before the full dashboard becomes available. You will gain access automatically once that is done - no action is needed from you right now."
            action={
              <Link href="/dashboard" className="inline-flex">
                <Button variant="secondary">
                  <IconShieldCheck className="size-4" />
                  Back to overview
                </Button>
              </Link>
            }
          />
        </CardContent>
      </Card>
    </>
  );
}
