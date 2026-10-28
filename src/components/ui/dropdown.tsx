"use client";

import * as React from "react";

import { cn } from "@/lib/utils/cn";

export type DropdownAlign = "start" | "end";

export interface DropdownProps {
  /** Element that opens the menu; receives the required props via a ref. */
  trigger: React.ReactElement<React.HTMLAttributes<HTMLElement>>;
  children: React.ReactNode;
  align?: DropdownAlign;
  className?: string;
  /** Accessible label for the menu. */
  label?: string;
}

export function Dropdown({
  trigger,
  children,
  align = "end",
  className,
  label = "Menu",
}: DropdownProps) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const triggerProps: React.HTMLAttributes<HTMLElement> & {
    "aria-expanded": boolean;
    "aria-haspopup": "menu";
    onClick: (event: React.MouseEvent<HTMLElement>) => void;
  } = {
    "aria-expanded": open,
    "aria-haspopup": "menu",
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      trigger.props.onClick?.(event);
      setOpen((value) => !value);
    },
  };

  return (
    <div ref={rootRef} className="relative">
      {React.cloneElement(trigger, triggerProps)}
      {open ? (
        <div
          role="menu"
          aria-label={label}
          className={cn(
            "absolute top-full z-50 mt-2 min-w-60 overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-panel animate-scale-in",
            align === "end" ? "right-0" : "left-0",
            className,
          )}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function DropdownLabel({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "px-3 pb-1.5 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle",
        className,
      )}
      {...props}
    />
  );
}

export interface DropdownItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Renders the item as unavailable instead of hiding it. */
  disabled?: boolean;
}

export function DropdownItem({
  className,
  disabled,
  children,
  ...props
}: DropdownItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-ink transition-colors",
        "hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
        "disabled:cursor-not-allowed disabled:bg-transparent disabled:text-ink-subtle disabled:hover:bg-transparent",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function DropdownSeparator({ className }: { className?: string }) {
  return <div className={cn("my-1 h-px bg-border", className)} role="separator" />;
}
