"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { getNavigationForRole, navigation } from "@/config/navigation";
import type { Role } from "@/config/roles";
import { cn } from "@/lib/utils/cn";
import type { NavigationItem } from "@/types/navigation";

export function isNavItemActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === href;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** True when the route matches the item's own href or any of its aliases. */
export function isNavigationItemActive(
  pathname: string,
  item: NavigationItem,
): boolean {
  if (isNavItemActive(pathname, item.href)) return true;
  return (item.activeHrefs ?? []).some((href) =>
    isNavItemActive(pathname, href),
  );
}

interface SidebarNavProps {
  /** Closes the mobile drawer after navigating. */
  onNavigate?: () => void;
  /** `drawer` variant shows supporting descriptions under each label. */
  variant?: "sidebar" | "drawer";
  /** When provided, renders the role-tailored navigation set. */
  role?: Role;
  /** Remaining accepted appointments today, shown as a red sidebar counter. */
  todayAppointmentCount?: number;
  /** Pending request counters keyed by navigation href. */
  requestCounts?: Record<string, number>;
  className?: string;
}

function NavItemLink({
  item,
  active,
  onNavigate,
  variant,
  badgeCount,
  badgeLabel,
}: {
  item: NavigationItem;
  active: boolean;
  onNavigate?: () => void;
  variant: "sidebar" | "drawer";
  badgeCount?: number;
  badgeLabel?: string;
}) {
  const Icon = item.icon;
  const showBadge = typeof badgeCount === "number" && badgeCount > 0;

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-lg font-medium transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        variant === "sidebar"
          ? "min-h-10 px-3 text-sm"
          : "min-h-12 px-3 py-2 text-[0.9375rem]",
        active
          ? "bg-primary-light text-primary-hover dark:bg-primary-muted"
          : "text-ink-muted hover:bg-hover-tint hover:text-ink",
      )}
    >
      <Icon
        className={cn(
          "size-5 shrink-0 transition-colors",
          active
            ? "text-primary-hover"
            : "text-ink-subtle group-hover:text-ink-muted",
        )}
      />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {showBadge ? (
        <span
          key={badgeCount}
          aria-label={badgeLabel}
          title={badgeLabel}
          className="animate-counter-pop inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-danger px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white shadow-sm"
        >
          {badgeCount > 99 ? "99+" : badgeCount}
        </span>
      ) : null}
      {variant === "drawer" && !active ? (
        <span className="hidden shrink-0 text-xs font-normal text-ink-subtle sm:block">
          {item.description}
        </span>
      ) : null}
    </Link>
  );
}

export function SidebarNav({
  onNavigate,
  variant = "sidebar",
  role,
  todayAppointmentCount = 0,
  requestCounts,
  className,
}: SidebarNavProps) {
  const pathname = usePathname();
  const groups = role ? getNavigationForRole(role) : navigation;

  return (
    <nav aria-label="Main navigation" className={cn("flex flex-col gap-6", className)}>
      {groups.map((group) => (
        <div key={group.label}>
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
            {group.label}
          </p>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const isAppointmentBadge =
                role === "DOCTOR" && item.href === "/doctor/appointments";
              const badgeCount = isAppointmentBadge
                ? todayAppointmentCount
                : requestCounts?.[item.href];
              const badgeLabel = isAppointmentBadge
                ? `${badgeCount} appointments remaining today`
                : `${badgeCount} pending request${
                    badgeCount === 1 ? "" : "s"
                  } for ${item.label}`;

              return (
                <li key={item.href}>
                  <NavItemLink
                    item={item}
                    active={isNavigationItemActive(pathname, item)}
                    onNavigate={onNavigate}
                    variant={variant}
                    badgeCount={badgeCount}
                    badgeLabel={badgeLabel}
                  />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
