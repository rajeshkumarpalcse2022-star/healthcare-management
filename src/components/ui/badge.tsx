import * as React from "react";

import { cn } from "@/lib/utils/cn";

export type BadgeVariant =
  | "neutral"
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "info";

export type BadgeSize = "sm" | "md";

const variantClasses: Record<BadgeVariant, string> = {
  neutral:
    "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
  primary:
    "border-primary/25 bg-primary-muted text-primary-dark dark:border-primary/30 dark:bg-primary/15",
  success: "border-success-line bg-success-soft text-success-strong",
  warning: "border-warning-line bg-warning-soft text-warning",
  danger: "border-danger-line bg-danger-soft text-danger",
  info: "border-info-line bg-info-soft text-info",
};

const sizeClasses: Record<BadgeSize, string> = {
  sm: "gap-1 px-1.5 py-0.5 text-[11px]",
  md: "gap-1.5 px-2.5 py-1 text-xs",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Renders a small status dot before the label. */
  dot?: boolean;
}

export function Badge({
  variant = "neutral",
  size = "md",
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-medium tracking-tight",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-current opacity-70"
        />
      ) : null}
      {children}
    </span>
  );
}
