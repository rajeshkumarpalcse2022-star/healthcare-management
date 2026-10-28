"use client";

import { ErrorState } from "@/components/ui/error-state";

/**
 * Root error boundary (`src/app/error.tsx`).
 *
 * Catches render failures anywhere below the root layout - notably the
 * `InfrastructureError` thrown while resolving the session in the dashboard
 * layout or pages during a database outage. Shows a friendly, retryable
 * state instead of bouncing a signed-in user to the login screen; `reset`
 * re-renders the failed subtree. Technical detail is deliberately not shown.
 */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-16">
      <ErrorState
        title="We couldn't load this page"
        description="This is usually temporary. Please try again in a moment."
        onRetry={reset}
        retryLabel="Try again"
        className="w-full max-w-md"
      />
    </div>
  );
}
