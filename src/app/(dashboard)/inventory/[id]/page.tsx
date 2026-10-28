import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { InventoryDetail } from "@/components/inventory/inventory-detail";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { ROLES } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Inventory item",
};

/** Roles allowed to view inventory items (mirrors the inventory API). */
const INVENTORY_ROLES: readonly string[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
];

/** One stock row: metadata, movement actions and append-only history. */
export default async function InventoryItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (!INVENTORY_ROLES.includes(user.role)) {
    redirect(getDashboardRouteForRole(user.role));
  }

  const { id } = await params;

  return <InventoryDetail id={id} />;
}
