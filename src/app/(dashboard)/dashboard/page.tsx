import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { IconArrowRight } from "@/components/icons";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { getNavigationForRole } from "@/config/navigation";
import { roleLabel } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Dashboard",
};

/**
 * Shared overview hub (`/dashboard`).
 *
 * Modules are filtered to the ones the signed-in role can actually reach;
 * each role also has a dedicated dashboard (linked from the header) that
 * serves as its post-login landing page.
 */
export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);

  const roleDashboard = getDashboardRouteForRole(user.role);
  const modules = getNavigationForRole(user.role)
    .flatMap((group) => group.items)
    .filter(
      (item) => item.href !== roleDashboard && item.href !== "/dashboard",
    );

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description={`Modules available to your ${roleLabel(user.role)} account.`}
        actions={
          <Link href={roleDashboard} className="inline-flex">
            <Button>
              Open my dashboard
              <IconArrowRight className="size-4" />
            </Button>
          </Link>
        }
      />

      <div className="mt-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="section-title">Modules</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Live modules open their workspace; planned modules show a
              placeholder until they ship.
            </p>
          </div>
          <Badge variant="primary" size="sm">
            {modules.length} listed
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {modules.map((module) => {
            const Icon = module.icon;
            return (
              <Link
                key={module.href}
                href={module.href}
                className="card card-interactive group flex items-start gap-4 p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary-light text-primary-hover transition-colors duration-200 group-hover:bg-primary-muted group-hover:text-primary-active dark:bg-primary/10 dark:text-brand-400 dark:group-hover:bg-primary/20 dark:group-hover:text-brand-300"
                  aria-hidden="true"
                >
                  <Icon className="size-5" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold tracking-tight text-ink">
                      {module.label}
                    </p>
                    <IconArrowRight className="mt-0.5 size-4 shrink-0 text-ink-subtle transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-primary-hover" />
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                    {module.description}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </>
  );
}
