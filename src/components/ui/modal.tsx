"use client";

import * as React from "react";
import { createPortal } from "react-dom";

import { IconX } from "@/components/icons";
import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/utils/cn";

export type ModalSize = "sm" | "md" | "lg" | "xl";

const sizeClasses: Record<ModalSize, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: ModalSize;
  /** Prevent closing via backdrop / Escape (e.g. while submitting). */
  dismissible?: boolean;
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
}: ModalProps) {
  const titleId = React.useId();
  const descriptionId = React.useId();
  const mounted = useMounted();

  React.useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissible) {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, dismissible, onClose]);

  if (!open || !mounted) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] overflow-y-auto p-4 sm:p-6"
      role="presentation"
    >
      <div
        className="fixed inset-0 bg-backdrop backdrop-blur-[2px] animate-fade-in"
        aria-hidden="true"
        onMouseDown={() => {
          if (dismissible) onClose();
        }}
      />

      <div className="relative flex min-h-full items-center justify-center">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          className={cn(
            "relative w-full rounded-panel border border-border bg-surface shadow-panel animate-scale-in",
            sizeClasses[size],
          )}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-start gap-4 border-b border-border px-5 py-4 sm:px-6">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-base font-semibold tracking-tight text-ink">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-1 text-sm text-ink-muted">
                  {description}
                </p>
              ) : null}
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={!dismissible}
              aria-label="Close dialog"
              className="-m-1.5 rounded-control p-1.5 text-ink-subtle transition hover:bg-surface-muted hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 disabled:pointer-events-none disabled:opacity-50"
            >
              <IconX className="size-5" />
            </button>
          </div>

          {children ? (
            <div className="px-5 py-5 sm:px-6 sm:py-6">{children}</div>
          ) : null}

          {footer ? (
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border bg-surface-muted px-5 py-4 sm:px-6">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
