import * as React from "react";

import { IconInbox } from "@/components/icons";
import { cn } from "@/lib/utils/cn";
import type { IconComponent } from "@/types/navigation";

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: IconComponent;
  /** Primary call to action rendered below the description. */
  action?: React.ReactNode;
  /** Renders a tighter variant for dropdowns and side panels. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon: Icon = IconInbox,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center",
        compact ? "px-4 py-6" : "state-panel",
        className,
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-full",
          compact ? "size-9" : "size-11",
          "bg-surface-muted text-ink-subtle",
        )}
        aria-hidden="true"
      >
        <Icon className={compact ? "size-4" : "size-5"} />
      </span>

      <p
        className={cn(
          "font-medium text-ink",
          compact ? "mt-2.5 text-sm" : "mt-4 text-sm sm:text-[0.9375rem]",
        )}
      >
        {title}
      </p>

      {description ? (
        <p
          className={cn(
            "text-ink-subtle",
            compact ? "mt-1 text-xs" : "mt-1.5 max-w-sm text-sm",
          )}
        >
          {description}
        </p>
      ) : null}

      {action ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
