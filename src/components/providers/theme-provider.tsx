"use client";

import * as React from "react";
import type { ReactNode } from "react";

/**
 * Self-contained theme provider (replaces `next-themes`).
 *
 * Why not next-themes: 0.4.6 (the latest release) renders its FOUC-prevention
 * `<script>` from inside this client component. React 19 / Next 16 flag any
 * component-created script ("Encountered a script tag while rendering React
 * component...") whenever a subtree is rendered client-side instead of
 * hydrated, and the package is unmaintained. The script now lives in
 * `theme-script.tsx` (Server Component, rendered from the root layout);
 * this file only owns reactive state: the persisted preference, the OS
 * preference, cross-tab sync and DOM application - no `<script>` anywhere.
 *
 * Contract kept identical to the previous setup so nothing else changes:
 * - `attribute="class"`: `<html>` carries `light` / `dark`
 * - `storageKey="theme"` in localStorage
 * - `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`
 */

export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  /** Raw stored preference, including `system`. */
  theme: Theme;
  /** Persist a new preference and apply it immediately. */
  setTheme: (theme: Theme) => void;
  /** The concrete theme after resolving `system` through the OS setting. */
  resolvedTheme: ResolvedTheme;
  /** The OS preference while `theme === "system"`. */
  systemTheme: ResolvedTheme;
  /** Every selectable preference. */
  themes: readonly Theme[];
}

const ThemeContext = React.createContext<ThemeContextValue | undefined>(
  undefined,
);

const STORAGE_KEY = "theme";
const THEMES = ["light", "dark", "system"] as const;
const DARK_QUERY = "(prefers-color-scheme: dark)";

function isTheme(value: unknown): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // Storage can be unavailable (private mode, blocked cookies).
  }
  return "system";
}

function resolveTheme(theme: Theme, systemTheme: ResolvedTheme): ResolvedTheme {
  return theme === "system" ? systemTheme : theme;
}

/**
 * Applies the resolved theme to `<html>` with transitions suppressed for the
 * switch (the old `disableTransitionOnChange` behaviour): a throwaway style
 * element disables transitions, the class flips, and the style is removed on
 * the next animation frame so subsequent interaction animates normally.
 */
function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;

  const style = document.createElement("style");
  style.setAttribute("data-theme-switch", "");
  style.appendChild(
    document.createTextNode(
      "*,*::before,*::after{-webkit-transition:none!important;transition:none!important;animation:none!important}",
    ),
  );
  document.head.appendChild(style);

  root.classList.remove("light", "dark");
  root.classList.add(resolved);
  root.style.colorScheme = resolved;

  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      style.remove();
    });
  });
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Defaults match the server snapshot (`system`), so hydration never
  // mismatches; the persisted value is read synchronously on the client the
  // same way next-themes did - consumers must stay SSR-stable pre-mount
  // (see ThemeToggle's mounted guard).
  const [theme, setThemeState] = React.useState<Theme>(() =>
    typeof window === "undefined" ? "system" : readStoredTheme(),
  );
  const [systemTheme, setSystemTheme] = React.useState<ResolvedTheme>(() =>
    getSystemTheme(),
  );

  const resolvedTheme = resolveTheme(theme, systemTheme);

  const setTheme = React.useCallback((next: Theme) => {
    setThemeState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference still applies for this session; persistence is best-effort.
    }
  }, []);

  // React to OS preference changes (only meaningful while `system`).
  React.useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const handleChange = () => {
      setSystemTheme(media.matches ? "dark" : "light");
    };
    handleChange();
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  // Cross-tab sync: another tab changed the stored preference.
  React.useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === STORAGE_KEY) {
        setThemeState(readStoredTheme());
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  // Keep <html> in sync with the resolved preference. On first load the
  // ThemeScript already applied the correct class, so this is a no-op there.
  React.useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      resolvedTheme,
      systemTheme,
      themes: THEMES,
    }),
    [theme, setTheme, resolvedTheme, systemTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

/** Returns the current theme state. Must render under `<ThemeProvider>`. */
export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside <ThemeProvider>.");
  }
  return context;
}
