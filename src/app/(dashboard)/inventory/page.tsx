import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InventoryList } from "@/components/inventory/inventory-list";
import { PageHeader } from "@/components/shared/page-header";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { ROLES } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Inventory",
};

/** Roles allowed to browse inventory (mirrors the inventory API). */
const INVENTORY_ROLES: readonly string[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
];

/** Laboratory stock surface (`/inventory`). */
export default async function InventoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (!INVENTORY_ROLES.includes(user.role)) {
    redirect(getDashboardRouteForRole(user.role));
  }

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Inventory"
        description="Laboratory stock with append-only movement history. Quantities change only through recorded transactions - receipts, consumptions and cycle counts."
      />
      <InventoryList />
    </>
  );
}
