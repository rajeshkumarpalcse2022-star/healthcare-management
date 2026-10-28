import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { UserLaboratoryAssignment } from "@/components/admin/user-laboratory-assignment";
import { PageHeader } from "@/components/shared/page-header";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { ROLES } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Staff Access",
};

/** Roles allowed to manage laboratory scope assignments (mirrors the API). */
const ASSIGNMENT_ROLES: readonly string[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
];

/** Admin laboratory-assignment surface (`/admin/users`). */
export default async function AdminUsersPage() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (!ASSIGNMENT_ROLES.includes(user.role)) {
    redirect(getDashboardRouteForRole(user.role));
  }

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Staff Access"
        description="Assign laboratories to lab manager and staff accounts. Scoped accounts only see and manage their assigned laboratories; other roles keep platform-wide access."
      />
      <UserLaboratoryAssignment />
    </>
  );
}
