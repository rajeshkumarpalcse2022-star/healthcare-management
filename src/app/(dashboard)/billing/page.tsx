import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InvoiceAccounts } from "@/components/billing/invoice-accounts";
import { PageHeader } from "@/components/shared/page-header";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { ROLES } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Billing & Payment",
};

/** Roles allowed to browse billing (mirrors the invoices API). */
const BILLING_ROLES: readonly string[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
];

/** Billing & payment ledger surface (`/billing`). */
export default async function BillingPage() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (!BILLING_ROLES.includes(user.role)) {
    redirect(getDashboardRouteForRole(user.role));
  }

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Billing & Payment"
        description="Internal invoice ledger for lab bookings and home collections. Draft, issue, collect payments and refunds - no external gateway."
      />
      <InvoiceAccounts />
    </>
  );
}
