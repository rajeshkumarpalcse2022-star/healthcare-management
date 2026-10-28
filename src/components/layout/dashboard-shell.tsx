"use client";

import * as React from "react";

import { APPOINTMENTS_CHANGED_EVENT } from "@/components/appointments/shared";
import { Header } from "@/components/layout/header";
import { MobileDrawer } from "@/components/layout/mobile-drawer";
import { Sidebar } from "@/components/layout/sidebar";
import { Container } from "@/components/layout/container";
import { useApiList } from "@/hooks/use-api-list";
import { localDateString } from "@/lib/utils/dashboard-rows";
import type { AppointmentSummary } from "@/types/appointment";
import type { SafeUser } from "@/types/auth";

/**
 * Dashboard application shell:
 * desktop sidebar + sticky header + main content + mobile navigation drawer.
 *
 * `user` comes from the server (authenticated layout) - it is display data
 * only; the server remains the source of truth for authorization.
 */
export function DashboardShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: SafeUser;
}) {
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  const [today] = React.useState(() => localDateString());
  const countUrl =
    user.role === "DOCTOR"
      ? `/api/appointments?dateFrom=${today}&dateTo=${today}&status=ACTIVE&limit=1`
      : "";
  const { state: todayState, refresh: refreshToday } =
    useApiList<AppointmentSummary>(countUrl);
  const todayAppointmentCount =
    user.role === "DOCTOR" ? todayState.meta.total : 0;

  React.useEffect(() => {
    if (user.role !== "DOCTOR") return;
    const onChanged = () => refreshToday();
    window.addEventListener(APPOINTMENTS_CHANGED_EVENT, onChanged);
    return () =>
      window.removeEventListener(APPOINTMENTS_CHANGED_EVENT, onChanged);
  }, [user.role, refreshToday]);

  return (
    <div className="flex min-h-dvh w-full bg-canvas">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-control focus:bg-brand-700 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus:shadow-raised"
      >
        Skip to content
      </a>

      <Sidebar
        user={user}
        todayAppointmentCount={todayAppointmentCount}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Header user={user} onMenuOpen={() => setMobileNavOpen(true)} />

        <main id="main-content" className="flex-1 py-6 sm:py-8">
          <Container>{children}</Container>
        </main>
      </div>

      <MobileDrawer
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        user={user}
        todayAppointmentCount={todayAppointmentCount}
      />
    </div>
  );
}
