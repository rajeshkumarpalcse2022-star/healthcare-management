import * as React from "react";

import { IconChevronDown } from "@/components/icons";
import { cn } from "@/lib/utils/cn";
import type { ControlSize } from "@/components/ui/input";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  label?: string;
  hint?: string;
  error?: string;
  options?: SelectOption[];
  placeholder?: string;
  controlSize?: ControlSize;
  containerClassName?: string;
}

const controlSizeClasses: Record<ControlSize, string> = {
  sm: "form-control-sm",
  md: "form-control-md",
  lg: "form-control-lg",
};

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  function Select(
    {
      label,
      hint,
      error,
      options,
      placeholder,
      controlSize = "md",
      className,
      containerClassName,
      id,
      required,
      children,
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
          <select
            ref={ref}
            id={inputId}
            required={required}
            aria-invalid={error ? true : undefined}
            className={cn(
              "form-control appearance-none pr-9",
              controlSizeClasses[controlSize],
              className,
            )}
            {...props}
          >
            {placeholder ? (
              <option value="" disabled>
                {placeholder}
              </option>
            ) : null}
            {options?.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
            {children}
          </select>

          <IconChevronDown className="pointer-events-none absolute inset-y-0 right-3 my-auto size-4 text-ink-subtle" />
        </div>

        {error ? (
          <p id={`${inputId ?? "select"}-error`} className="form-error" role="alert">
            {error}
          </p>
        ) : hint ? (
          <p id={`${inputId ?? "select"}-hint`} className="form-hint">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
