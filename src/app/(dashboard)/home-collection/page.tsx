import type { Metadata } from "next";
import Link from "next/link";

import { CollectionFlow } from "@/components/home-collection/collection-flow";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconHome, IconShieldCheck } from "@/components/icons";
import { PageHeader } from "@/components/shared/page-header";
import {
  canCreateCollection,
  canViewCollectionManagement,
} from "@/config/home-collection";
import { ROLES } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Home Collection",
};

/**
 * Home sample collection entry point (`/home-collection`).
 *
 * - patients (and super admin / admin creating on their behalf) see the
 *   request wizard;
 * - collectors are directed to their assignment board;
 * - operational management roles are directed to the management list;
 * - other roles get an explicit no-access state. The API re-enforces the
 *   same rules on every request.
 */
export default async function HomeCollectionPage() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <>
        <PageHeader
          eyebrow="Diagnostics"
          title="Home collection"
          description="Request and track home sample pickups."
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Home collection" },
          ]}
        />
        <Card>
          <CardContent>
            <EmptyState
              icon={IconShieldCheck}
              title="Sign in required"
              description="Sign in to request or manage home sample collections."
            />
          </CardContent>
        </Card>
      </>
    );
  }

  if (user.role === ROLES.COLLECTOR) {
    return (
      <>
        <PageHeader
          eyebrow="Diagnostics"
          title="Home collection"
          description="Your assigned home pickups."
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Home collection" },
          ]}
          actions={
            <Link href="/my-assignments" className="inline-flex">
              <Button>
                <IconHome className="size-4" />
                My assignments
              </Button>
            </Link>
          }
        />
        <Card>
          <CardContent>
            <EmptyState
              icon={IconHome}
              title="Collector assignment board"
              description="Assigned pickups appear on your assignment board, where you can start the route, mark arrival, record collection or flag a failed pickup."
              action={
                <Link href="/my-assignments" className="inline-flex">
                  <Button>Open my assignments</Button>
                </Link>
              }
            />
          </CardContent>
        </Card>
      </>
    );
  }

  if (!canCreateCollection(user.role)) {
    // Management roles (LAB_MANAGER, STAFF) land here instead of a dead
    // "no access" state - the wizard is for patients, the review list is
    // for them.
    if (canViewCollectionManagement(user.role)) {
      return (
        <>
          <PageHeader
            eyebrow="Diagnostics"
            title="Home collection"
            description="Review and manage home sample collection requests."
            breadcrumbs={[
              { label: "Dashboard", href: "/dashboard" },
              { label: "Home collection" },
            ]}
            actions={
              <Link href="/home-collections/manage" className="inline-flex">
                <Button>
                  <IconHome className="size-4" />
                  Open request list
                </Button>
              </Link>
            }
          />
          <Card>
            <CardContent>
              <EmptyState
                icon={IconHome}
                title="Manage collection requests"
                description="Review new pickup requests, accept or reject them, and assign collectors from the management list."
                action={
                  <Link href="/home-collections/manage" className="inline-flex">
                    <Button>Open request list</Button>
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
          title="Home collection"
          description="Request and track home sample pickups."
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Home collection" },
          ]}
        />
        <Card>
          <CardContent>
            <EmptyState
              icon={IconShieldCheck}
              title="No access to home collection requests"
              description="You do not have permission to create home collection requests. Contact your administrator if you believe this is a mistake."
            />
          </CardContent>
        </Card>
      </>
    );
  }

  return <CollectionFlow user={user} />;
}
