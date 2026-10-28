"use client";

import { useRouter } from "next/navigation";

import { IconChevronDown, IconLogOut, IconUser } from "@/components/icons";
import { useLogout } from "@/hooks/use-logout";
import { ROLES, roleLabel } from "@/config/roles";
import {
  Dropdown,
  DropdownItem,
  DropdownSeparator,
} from "@/components/ui/dropdown";
import { Badge } from "@/components/ui/badge";
import type { SafeUser } from "@/types/auth";

function initialOf(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

/**
 * Authenticated account menu: shows the signed-in user's identity and role,
 * links to the role-appropriate profile page and signs out through the real
 * logout endpoint.
 */
export function UserMenu({ user }: { user: SafeUser }) {
  const router = useRouter();
  const { logout, isLoggingOut } = useLogout();
  const firstName = user.name.trim().split(/\s+/)[0] || user.name;

  function openProfile() {
    if (user.role === ROLES.DOCTOR) {
      router.push("/doctors");
      return;
    }
    router.push("/profile");
  }

  return (
    <Dropdown
      label="Account menu"
      className="w-64"
      trigger={
        <button
          type="button"
          aria-label="Account menu"
          className="flex items-center gap-2 rounded-full py-1 pl-1 pr-1.5 text-ink-muted transition hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 sm:pr-2.5"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-700 text-white text-sm font-semibold">
            {initialOf(user.name)}
          </span>
          <span className="hidden max-w-28 truncate text-sm font-medium md:block">
            {firstName}
          </span>
          <IconChevronDown className="hidden size-4 text-ink-subtle md:block" />
        </button>
      }
    >
      <div className="flex items-start gap-3 px-3 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-semibold text-white">
          {initialOf(user.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{user.name}</p>
          <p className="truncate text-xs text-ink-subtle">{user.email}</p>
        </div>
        <Badge variant="primary" size="sm">
          {roleLabel(user.role)}
        </Badge>
      </div>

      <DropdownSeparator />

      <DropdownItem onClick={openProfile}>
        <IconUser className="size-4 text-ink-subtle" />
        My profile
      </DropdownItem>

      <DropdownItem onClick={() => void logout()} disabled={isLoggingOut}>
        <IconLogOut className="size-4 text-ink-subtle" />
        {isLoggingOut ? "Signing out..." : "Sign out"}
      </DropdownItem>
    </Dropdown>
  );
}
