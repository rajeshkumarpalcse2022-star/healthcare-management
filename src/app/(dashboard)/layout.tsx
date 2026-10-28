import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/layout/dashboard-shell";
import { LOGIN_ROUTE } from "@/config/auth";
import { getCurrentUser } from "@/lib/auth";
import type { SafeUser } from "@/types/auth";

/**
 * Authoritative gate for every dashboard route: the session cookie must
 * verify AND the user must still exist and be active. (`src/proxy.ts` already
 * performed the cheap presence check before rendering.)
 */
async function requireDashboardUser(): Promise<SafeUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(LOGIN_ROUTE);
  }
  return user;
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireDashboardUser();

  return <DashboardShell user={user}>{children}</DashboardShell>;
}
