import * as React from "react";

import { cn } from "@/lib/utils/cn";

export type ControlSize = "sm" | "md" | "lg";

const controlSizeClasses: Record<ControlSize, string> = {
  sm: "form-control-sm",
  md: "form-control-md",
  lg: "form-control-lg",
};

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  hint?: string;
  error?: string;
  /** Decorative leading icon (lucide-style SVG). */
  icon?: React.ReactNode;
  /** Interactive trailing slot (e.g. a show/hide password toggle). */
  trailing?: React.ReactNode;
  controlSize?: ControlSize;
  containerClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input(
    {
      label,
      hint,
      error,
      icon,
      trailing,
      controlSize = "md",
      className,
      containerClassName,
      id,
      required,
      type = "text",
      ...props
    },
    ref,
  ) {
    const inputId = id ?? props.name;

    return (
      <div className={cn("w-full", containerClassName)}>
        {label ? (
          <label htmlFor={inputId} className="form-label">
            {label}
            {required ? (
              <span className="form-required" aria-hidden="true">
                *
              </span>
            ) : null}
          </label>
        ) : null}

        <div className="relative">
          {icon ? (
            <span className="pointer-events-none absolute inset-y-0 left-0 flex w-10 items-center justify-center text-ink-subtle">
              {icon}
            </span>
          ) : null}
          <input
            ref={ref}
            id={inputId}
            type={type}
            required={required}
            aria-invalid={error ? true : undefined}
            aria-describedby={
              error
                ? `${inputId ?? "input"}-error`
                : hint
                  ? `${inputId ?? "input"}-hint`
                  : undefined
            }
            className={cn(
              "form-control",
              controlSizeClasses[controlSize],
              icon && "pl-10",
              trailing && "pr-10",
              className,
            )}
            {...props}
          />
          {trailing ? (
            <span className="absolute inset-y-0 right-0 flex w-10 items-center justify-center">
              {trailing}
            </span>
          ) : null}
        </div>

        {error ? (
          <p id={`${inputId ?? "input"}-error`} className="form-error" role="alert">
            {error}
          </p>
        ) : hint ? (
          <p id={`${inputId ?? "input"}-hint`} className="form-hint">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
