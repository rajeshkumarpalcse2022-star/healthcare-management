"use client";

import * as React from "react";

import {
  IconAlertTriangle,
  IconCheckCircle,
  IconInfo,
  IconX,
} from "@/components/icons";
import { cn } from "@/lib/utils/cn";

export type ToastVariant = "default" | "success" | "error" | "warning" | "info";

export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** Milliseconds before auto-dismiss. `0` keeps the toast until closed. */
  duration?: number;
}

interface ToastItem extends ToastInput {
  id: string;
}

interface ToastContextValue {
  toast: (input: ToastInput) => string;
  success: (title: string, description?: string) => string;
  error: (title: string, description?: string) => string;
  dismiss: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

const variantStyles: Record<ToastVariant, { wrapper: string; icon: string }> = {
  default: {
    wrapper: "border-border bg-surface",
    icon: "bg-surface-muted text-ink-muted",
  },
  success: {
    wrapper: "border-success-line bg-success-tint",
    icon: "bg-surface text-success",
  },
  error: {
    wrapper: "border-danger-line bg-surface",
    icon: "bg-danger-soft text-danger",
  },
  warning: {
    wrapper: "border-warning-line bg-surface",
    icon: "bg-warning-soft text-warning",
  },
  info: {
    wrapper: "border-info-line bg-surface",
    icon: "bg-info-soft text-info",
  },
};

function VariantIcon({ variant }: { variant: ToastVariant }) {
  const className = "size-4 shrink-0";
  switch (variant) {
    case "success":
      return <IconCheckCircle className={className} />;
    case "error":
    case "warning":
      return <IconAlertTriangle className={className} />;
    case "info":
      return <IconInfo className={className} />;
    default:
      return <IconInfo className={className} />;
  }
}

/**
 * Toast/notification foundation.
 * Presentational only - it does not read or generate business data.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const timersRef = React.useRef(new Map<string, number>());

  const dismiss = React.useCallback((id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const toast = React.useCallback(
    (input: ToastInput) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const duration = input.duration ?? 5000;

      setItems((current) => [...current, { ...input, id }].slice(-4));

      if (duration > 0) {
        const timer = window.setTimeout(() => dismiss(id), duration);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [dismiss],
  );

  const success = React.useCallback(
    (title: string, description?: string) => toast({ title, description, variant: "success" }),
    [toast],
  );

  const error = React.useCallback(
    (title: string, description?: string) => toast({ title, description, variant: "error" }),
    [toast],
  );

  React.useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const value = React.useMemo(
    () => ({ toast, success, error, dismiss }),
    [toast, success, error, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-[90] flex flex-col items-end gap-2.5 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-full sm:max-w-sm"
      >
        {items.map((item) => {
          const variant = item.variant ?? "default";
          const styles = variantStyles[variant];

          return (
            <div
              key={item.id}
              role={variant === "error" ? "alert" : "status"}
              className={cn(
                "pointer-events-auto flex w-full items-start gap-3 rounded-card border p-4 shadow-panel animate-slide-in-right",
                styles.wrapper,
              )}
            >
              <span
                className={cn("flex size-8 shrink-0 items-center justify-center rounded-full", styles.icon)}
                aria-hidden="true"
              >
                <VariantIcon variant={variant} />
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{item.title}</p>
                {item.description ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
                    {item.description}
                  </p>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss notification"
                className="-m-1 rounded-md p-1 text-ink-subtle transition hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                <IconX className="size-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = React.useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a <ToastProvider>");
  }
  return context;
}
