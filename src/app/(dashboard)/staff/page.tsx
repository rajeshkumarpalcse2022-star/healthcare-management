import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { StaffAccounts } from "@/components/staff/staff-accounts";
import { PageHeader } from "@/components/shared/page-header";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { ROLES } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Staff",
};

/** Roles allowed to manage staff accounts (mirrors the users API). */
const STAFF_MANAGEMENT_ROLES: readonly string[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
];

/** Staff account provisioning surface (`/staff`). */
export default async function StaffPage() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (!STAFF_MANAGEMENT_ROLES.includes(user.role)) {
    redirect(getDashboardRouteForRole(user.role));
  }

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Staff"
        description="Create and manage privileged accounts - lab managers, staff, doctors, collectors and administrators. Assign laboratory access from Administration → Staff Access."
      />
      <StaffAccounts />
    </>
  );
}
