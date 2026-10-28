"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  IconAlertTriangle,
  IconEye,
  IconEyeOff,
  IconLock,
  IconMail,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { AuthErrorBody, LoginSuccessBody } from "@/types/auth";

interface FieldErrors {
  email?: string;
  password?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Client sign-in form.
 *
 * Performs light required/format checks for responsiveness only - the server
 * revalidates everything with Zod and is the source of truth for the result.
 */
export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get("next");

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [rememberMe, setRememberMe] = React.useState(false);

  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      errors.email = "Email is required.";
    } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
      errors.email = "Enter a valid email address.";
    }

    if (!password) {
      errors.password = "Password is required.";
    }

    return errors;
  }

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (isSubmitting) return;

    setFormError(null);

    const errors = validate();
    setFieldErrors(errors);
    if (errors.email || errors.password) return;

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          rememberMe,
          next: nextParam ?? undefined,
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | LoginSuccessBody
        | AuthErrorBody
        | null;

      if (response.ok && data && data.success) {
        router.push(data.redirectTo || "/dashboard");
        router.refresh();
        return;
      }

      if (
        response.status === 400 &&
        data &&
        !data.success &&
        Array.isArray(data.issues)
      ) {
        const mapped: FieldErrors = {};
        for (const issue of data.issues) {
          if (issue.field === "email") {
            mapped.email = issue.message;
          } else if (issue.field === "password") {
            mapped.password = issue.message;
          }
        }
        setFieldErrors(mapped);
        if (!mapped.email && !mapped.password) {
          setFormError(data.error);
        }
        return;
      }

      setFormError(
        data && !data.success
          ? data.error
          : "Unable to sign you in right now. Please try again.",
      );
    } catch {
      setFormError(
        "Unable to reach the server. Check your connection and try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-6 sm:p-8">
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          {formError ? (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-control border border-danger-line bg-danger-soft px-3.5 py-3 text-sm font-medium text-danger animate-fade-in"
            >
              <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p className="min-w-0 leading-relaxed">{formError}</p>
            </div>
          ) : null}

          <Input
            label="Email address"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            autoFocus
            placeholder="you@clinic.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={fieldErrors.email}
            icon={<IconMail className="size-4" />}
            disabled={isSubmitting}
          />

          <Input
            label="Password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            placeholder="Enter your password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={fieldErrors.password}
            icon={<IconLock className="size-4" />}
            disabled={isSubmitting}
            trailing={
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                tabIndex={-1}
                className="rounded-md p-1.5 text-ink-subtle transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                {showPassword ? (
                  <IconEyeOff className="size-4" />
                ) : (
                  <IconEye className="size-4" />
                )}
              </button>
            }
          />

          <label className="flex w-fit cursor-pointer select-none items-center gap-2.5 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(event) => setRememberMe(event.target.checked)}
              disabled={isSubmitting}
              className="size-4 shrink-0 rounded border-border-strong accent-primary"
            />
            Keep me signed in on this device
          </label>

          <Button
            type="submit"
            className="w-full"
            size="lg"
            loading={isSubmitting}
          >
            Sign in
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
