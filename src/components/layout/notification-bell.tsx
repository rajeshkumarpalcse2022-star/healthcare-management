"use client";

import { IconBell } from "@/components/icons";
import { EmptyState } from "@/components/ui/empty-state";
import { Dropdown } from "@/components/ui/dropdown";

/**
 * Notification area. The source of notifications is not wired yet, so the
 * menu honestly reports an empty state instead of showing invented data.
 */
export function NotificationBell() {
  return (
    <Dropdown
      label="Notifications"
      className="w-[min(21rem,calc(100vw-2rem))] p-0"
      trigger={
        <button
          type="button"
          aria-label="Notifications"
          className="flex size-10 items-center justify-center rounded-full text-ink-muted transition hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
        >
          <IconBell className="size-5" />
        </button>
      }
    >
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-semibold tracking-tight text-ink">
          Notifications
        </p>
        <p className="mt-0.5 text-xs text-ink-subtle">Recent platform activity</p>
      </div>

      <div className="p-2">
        <EmptyState
          compact
          title="No notifications yet"
          description="Real events from the platform modules will appear here."
        />
      </div>
    </Dropdown>
  );
}
