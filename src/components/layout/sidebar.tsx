import { APP_NAME, APP_TAGLINE } from "@/config/constants";
import { BrandMark } from "@/components/layout/brand-mark";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { cn } from "@/lib/utils/cn";
import type { SafeUser } from "@/types/auth";

/** Desktop sidebar. Hidden below the `lg` breakpoint. */
export function Sidebar({
  user,
  todayAppointmentCount = 0,
  className,
}: {
  user: SafeUser;
  todayAppointmentCount?: number;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-border bg-chrome lg:flex",
        className,
      )}
    >
      <div className="flex h-16 items-center gap-3 border-b border-border px-5">
        <BrandMark />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-ink">
            {APP_NAME}
          </p>
          <p className="truncate text-[11px] text-ink-subtle">{APP_TAGLINE}</p>
        </div>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-3 py-5">
        <SidebarNav
          role={user.role}
          todayAppointmentCount={todayAppointmentCount}
        />
      </div>

      <div className="border-t border-border px-5 py-4">
        <p className="text-[11px] leading-relaxed text-ink-muted">
          Application shell is ready. Business modules are implemented in later
          steps.
        </p>
      </div>
    </aside>
  );
}
