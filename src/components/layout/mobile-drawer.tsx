"use client";

import * as React from "react";

import { IconLogOut, IconX } from "@/components/icons";
import { BrandMark } from "@/components/layout/brand-mark";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { APP_NAME } from "@/config/constants";
import { roleLabel } from "@/config/roles";
import { useLogout } from "@/hooks/use-logout";
import { cn } from "@/lib/utils/cn";
import type { SafeUser } from "@/types/auth";

export interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
  /** Authenticated user supplied by the server-rendered shell. */
  user: SafeUser;
  /** Remaining accepted appointments today (doctor sidebar badge). */
  todayAppointmentCount?: number;
}

/** Off-canvas navigation for mobile and tablet viewports. */
export function MobileDrawer({
  open,
  onClose,
  user,
  todayAppointmentCount = 0,
}: MobileDrawerProps) {
  const { logout, isLoggingOut } = useLogout();
  React.useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  return (
    <div
      className={cn(
        "fixed inset-0 z-[60] lg:hidden",
        open ? "" : "pointer-events-none",
      )}
      aria-hidden={!open}
    >
      <div
        className={cn(
          "absolute inset-0 bg-backdrop backdrop-blur-[2px] transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0",
        )}
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className={cn(
          "absolute inset-y-0 left-0 flex w-[min(19rem,85vw)] flex-col border-r border-border bg-chrome shadow-panel transition-transform duration-250 ease-out",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between gap-3 border-b border-border px-4">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark />
            <p className="truncate text-sm font-semibold tracking-tight text-ink">
              {APP_NAME}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="rounded-control p-2 text-ink-subtle transition hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <IconX className="size-5" />
          </button>
        </div>

        <div className="scrollbar-thin flex-1 overflow-y-auto px-3 py-5">
          <SidebarNav
            variant="drawer"
            onNavigate={onClose}
            role={user.role}
            todayAppointmentCount={todayAppointmentCount}
          />
        </div>

        <div className="flex items-center gap-2.5 border-t border-border px-4 py-4">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-semibold text-white">
            {user.name.trim().charAt(0).toUpperCase() || "?"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">
              {user.name}
            </p>
            <p className="mt-0.5 truncate text-xs text-ink-muted">
              {roleLabel(user.role)} · {user.email}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            disabled={isLoggingOut}
            aria-label="Sign out"
            className="rounded-control p-2 text-ink-subtle transition hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:pointer-events-none disabled:opacity-55"
          >
            <IconLogOut className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
