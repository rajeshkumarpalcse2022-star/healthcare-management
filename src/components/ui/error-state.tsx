import * as React from "react";

import { IconAlertTriangle } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

export interface ErrorStateProps {
  title?: string;
  description?: string;
  /** Technical detail surfaced to the user (kept out of the default copy). */
  detail?: string;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}

export function ErrorState({
  title = "Something went wrong",
  description = "The request could not be completed. Please try again.",
  detail,
  onRetry,
  retryLabel = "Try again",
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn("state-panel state-panel-error", className)}
    >
      <span
        className="flex size-11 items-center justify-center rounded-full bg-rose-100 text-danger dark:bg-rose-950"
        aria-hidden="true"
      >
        <IconAlertTriangle className="size-5" />
      </span>

      <p className="mt-4 text-sm font-medium text-ink sm:text-[0.9375rem]">
        {title}
      </p>
      <p className="mt-1.5 max-w-sm text-sm text-ink-subtle">{description}</p>

      {detail ? (
        <code className="mt-3 max-w-full overflow-x-auto rounded-md border border-danger-line bg-surface px-2.5 py-1.5 text-left text-xs text-rose-700 dark:text-rose-300">
          {detail}
        </code>
      ) : null}

      {onRetry ? (
        <div className="mt-4">
          <Button variant="outline" size="sm" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
