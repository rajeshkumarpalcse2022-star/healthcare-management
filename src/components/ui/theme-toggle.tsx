"use client";

import * as React from "react";

import { IconMonitor, IconMoon, IconSun } from "@/components/icons";
import { useTheme } from "@/components/providers/theme-provider";
import { cn } from "@/lib/utils/cn";

/** Client-mount detector that never mismatches the server snapshot. */
function useMounted(): boolean {
  return React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/**
 * Cycles theme: system → light → dark → system.
 * Respects the persisted preference (localStorage via ThemeProvider).
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const mounted = useMounted();

  if (!mounted) {
    return (
      <button
        type="button"
        disabled
        aria-label="Theme"
        className={cn(
          "flex size-10 items-center justify-center rounded-control text-ink-muted opacity-60",
          className,
        )}
      >
        <IconSun className="size-5" />
      </button>
    );
  }

  const current = theme ?? "system";
  const isDark = resolvedTheme === "dark";

  function cycle() {
    if (current === "system") setTheme("light");
    else if (current === "light") setTheme("dark");
    else setTheme("system");
  }

  const label =
    current === "system"
      ? `Theme: system (${isDark ? "dark" : "light"})`
      : `Theme: ${current}`;

  return (
    <button
      type="button"
      onClick={cycle}
      aria-label={label}
      title={label}
      className={cn(
        "flex size-10 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        className,
      )}
    >
      {current === "system" ? (
        <IconMonitor className="size-5" />
      ) : isDark ? (
        <IconMoon className="size-5" />
      ) : (
        <IconSun className="size-5" />
      )}
    </button>
  );
}
