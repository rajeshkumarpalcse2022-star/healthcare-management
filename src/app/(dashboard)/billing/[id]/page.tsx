import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InvoiceDetail } from "@/components/billing/invoice-detail";
import { PageHeader } from "@/components/shared/page-header";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { ROLES } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Invoice detail",
};

/** Roles allowed to open invoice detail (staff; PATIENT gets owner-only 404 semantics from the API). */
const BILLING_ROLES: readonly string[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
  ROLES.PATIENT,
];

/** Invoice detail surface (`/billing/[id]`). */
export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (!BILLING_ROLES.includes(user.role)) {
    redirect(getDashboardRouteForRole(user.role));
  }

  const { id } = await params;

  return (
    <>
      <PageHeader
        eyebrow="Billing & Payment"
        title="Invoice"
        description="Line items, payments, refunds and the append-only audit timeline."
      />
      <InvoiceDetail id={id} />
    </>
  );
}
