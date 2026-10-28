import * as React from "react";

import { cn } from "@/lib/utils/cn";

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  containerClassName?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { label, hint, error, className, containerClassName, id, required, ...props },
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

        <textarea
          ref={ref}
          id={inputId}
          required={required}
          aria-invalid={error ? true : undefined}
          className={cn("form-control form-control-md min-h-28 py-2.5", className)}
          {...props}
        />

        {error ? (
          <p id={`${inputId ?? "textarea"}-error`} className="form-error" role="alert">
            {error}
          </p>
        ) : hint ? (
          <p id={`${inputId ?? "textarea"}-hint`} className="form-hint">
            {hint}
          </p>
        ) : null}
      </div>
    );
  },
);
