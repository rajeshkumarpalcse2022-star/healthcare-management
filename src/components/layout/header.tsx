"use client";

import { UserMenu } from "@/components/layout/user-menu";
import { BrandMark } from "@/components/layout/brand-mark";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { IconMenu } from "@/components/icons";
import { APP_NAME } from "@/config/constants";
import type { SafeUser } from "@/types/auth";

export interface HeaderProps {
  user: SafeUser;
  onMenuOpen: () => void;
}

/** Sticky top header: mobile navigation trigger, brand, theme and account. */
export function Header({ user, onMenuOpen }: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-chrome/90 backdrop-blur-md">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8 xl:px-10">
        <button
          type="button"
          onClick={onMenuOpen}
          aria-label="Open navigation"
          className="flex size-10 items-center justify-center rounded-control text-ink-muted transition hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 lg:hidden"
        >
          <IconMenu className="size-5" />
        </button>

        <div className="flex min-w-0 items-center gap-2.5 lg:hidden">
          <BrandMark className="size-8" />
          <p className="truncate text-sm font-semibold tracking-tight text-ink">
            {APP_NAME}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <ThemeToggle />

          <span
            aria-hidden="true"
            className="hidden h-6 w-px bg-border sm:block"
          />

          <UserMenu user={user} />
        </div>
      </div>
    </header>
  );
}
