import type { Metadata } from "next";
import Link from "next/link";

import { MyCollectionsList } from "@/components/home-collection/my-collections-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconHome, IconShieldCheck } from "@/components/icons";
import { PageHeader } from "@/components/shared/page-header";
import { ROLES } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "My pickup requests",
};

/**
 * The authenticated patient's home collection history.
 *
 * The list API hard-scopes every query to the session's own requests, so this
 * page never passes an identity it could get wrong. Other roles see an
 * explanatory empty state instead of data they are not entitled to.
 */
export default async function MyCollectionsPage() {
  const user = await getCurrentUser();
  const isPatient = user?.role === ROLES.PATIENT;

  return (
    <>
      <PageHeader
        eyebrow="Diagnostics"
        title="My pickup requests"
        description={
          isPatient
            ? "Your home sample collection requests - track pickup status or cancel when eligible."
            : "Collection history is available to patient accounts."
        }
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "My pickup requests" },
        ]}
        actions={
          isPatient ? (
            <Link href="/home-collection" className="inline-flex">
              <Button>
                <IconHome className="size-4" />
                Request a pickup
              </Button>
            </Link>
          ) : undefined
        }
      />

      {isPatient ? (
        <MyCollectionsList mode="patient" />
      ) : (
        <Card>
          <CardContent>
            <EmptyState
              icon={IconShieldCheck}
              title="No patient collections for this account"
              description="Sign in with a patient account to see its collection history."
              action={
                <Link href="/home-collection" className="inline-flex">
                  <Button variant="outline">Go to home collection</Button>
                </Link>
              }
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
