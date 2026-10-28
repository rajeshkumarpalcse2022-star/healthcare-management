import type { Metadata } from "next";

import { CollectionDetail } from "@/components/home-collection/collection-detail";
import { PageHeader } from "@/components/shared/page-header";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Collection details",
};

/**
 * Authorised collection detail (`/home-collections/[id]`).
 *
 * Shared by patients (their own requests), collectors (their assignments)
 * and operational roles; the API decides who may see the record and returns
 * a neutral 404 otherwise.
 */
export default async function CollectionDetailPage({
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
        title="Collection details"
        description="Reference, pickup schedule, tests, activity and status actions."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Collection details" },
        ]}
      />
      {user ? <CollectionDetail collectionId={id} user={user} /> : null}
    </>
  );
}
