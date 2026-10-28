"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useToast } from "@/components/ui/toast";

/**
 * Signs the user out via the real logout endpoint, then routes to /login.
 * The server clears the HTTP-only cookie; `router.refresh()` re-runs server
 * components so no authenticated UI stays behind.
 */
export function useLogout(): {
  logout: () => Promise<void>;
  isLoggingOut: boolean;
} {
  const router = useRouter();
  const { error: showError } = useToast();
  const [isLoggingOut, setIsLoggingOut] = React.useState(false);

  const logout = React.useCallback(async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);

    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) {
        throw new Error("Logout request failed");
      }

      router.push("/login");
      router.refresh();
    } catch {
      setIsLoggingOut(false);
      showError(
        "Unable to sign out",
        "Something went wrong. Please try again.",
      );
    }
  }, [isLoggingOut, router, showError]);

  return { logout, isLoggingOut };
}
