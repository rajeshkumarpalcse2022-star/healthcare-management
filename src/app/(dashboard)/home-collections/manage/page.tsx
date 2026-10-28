import type { Metadata } from "next";
import Link from "next/link";

import { CollectionRequestsList } from "@/components/collection-requests/requests-list";
import { HomeCollectionsList } from "@/components/home-collection/home-collections-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconShieldCheck } from "@/components/icons";
import { PageHeader } from "@/components/shared/page-header";
import { canViewCollectionManagement } from "@/config/home-collection";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Collection Management",
};

const TAB_LINK_CLASS =
  "rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60";

const TAB_ACTIVE_CLASS =
  "bg-primary-light text-primary-active dark:bg-primary-muted dark:text-brand-300";
const TAB_IDLE_CLASS =
  "text-ink-muted hover:bg-surface-muted hover:text-ink";

/**
 * Central review surface (`/home-collections/manage`).
 *
 * Two tabs over the same operational window:
 * - **Collection requests** (default) - the merged queue of every lab-visit
 *   booking and home-collection request awaiting or carrying a review
 *   decision (`/api/collection-requests`);
 * - **Home collections** - the existing home-collection management list,
 *   where accepted requests are assigned collectors and tracked to pickup.
 *
 * Visible to super admin, admin, lab manager and staff - the same read policy
 * the collection module already applies. Other roles get an explicit
 * no-access state; the API re-enforces the same rules on every request.
 */
export default async function ManageCollectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const user = await getCurrentUser();
  const allowed = user !== null && canViewCollectionManagement(user.role);
  const { view } = await searchParams;
  const activeTab = view === "collections" ? "collections" : "requests";

  return (
    <>
      <PageHeader
        eyebrow="Diagnostics"
        title="Collection management"
        description="Review every lab-visit and home-collection request in one queue, then manage accepted pickups through to collection."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Collections", href: "/home-collections/manage" },
          { label: "Management" },
        ]}
        actions={
          allowed ? (
            <div className="flex flex-wrap items-center gap-3">
              <div
                role="tablist"
                aria-label="Collection management sections"
                className="inline-flex rounded-control border border-border bg-surface p-1"
              >
                <Link
                  href="/home-collections/manage?view=requests"
                  role="tab"
                  aria-selected={activeTab === "requests"}
                  className={`${TAB_LINK_CLASS} ${
                    activeTab === "requests" ? TAB_ACTIVE_CLASS : TAB_IDLE_CLASS
                  }`}
                >
                  Collection requests
                </Link>
                <Link
                  href="/home-collections/manage?view=collections"
                  role="tab"
                  aria-selected={activeTab === "collections"}
                  className={`${TAB_LINK_CLASS} ${
                    activeTab === "collections"
                      ? TAB_ACTIVE_CLASS
                      : TAB_IDLE_CLASS
                  }`}
                >
                  Home collections
                </Link>
              </div>
              <Link href="/home-collection" className="inline-flex">
                <Button variant="outline">Patient request flow</Button>
              </Link>
            </div>
          ) : undefined
        }
      />

      {user && allowed ? (
        activeTab === "requests" ? (
          <CollectionRequestsList />
        ) : (
          <HomeCollectionsList user={user} />
        )
      ) : (
        <Card>
          <CardContent>
            <EmptyState
              icon={IconShieldCheck}
              title="No access to collection management"
              description="You do not have permission to view collection management. Contact your administrator if you believe this is a mistake."
            />
          </CardContent>
        </Card>
      )}
    </>
  );
}
