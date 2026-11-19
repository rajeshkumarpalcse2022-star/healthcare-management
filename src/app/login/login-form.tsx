"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  IconAlertTriangle,
  IconEye,
  IconEyeOff,
  IconFlaskConical,
  IconLock,
  IconMail,
  IconMapPin,
  IconShieldCheck,
  IconStethoscope,
  IconUser,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DEMO_ACCOUNTS,
  DEMO_ACCOUNT_PASSWORD,
  type DemoAccount,
} from "@/config/demo-accounts";
import type { AuthErrorBody, LoginSuccessBody } from "@/types/auth";

interface FieldErrors {
  email?: string;
  password?: string;
}

const DEMO_ACCOUNT_ICONS: Record<
  string,
  (props: React.SVGProps<SVGSVGElement>) => React.JSX.Element
> = {
  ADMIN: IconShieldCheck,
  DOCTOR: IconStethoscope,
  LAB_MANAGER: IconFlaskConical,
  PATIENT: IconUser,
  COLLECTOR: IconMapPin,
};

/**
 * Client sign-in form.
 *
 * Performs light required/format checks for responsiveness only - the server
 * revalidates everything with Zod and is the source of truth for the result.
 * The identifier field accepts an email address or a unique account ID
 * (`DOC-XXXXX` / `LAB-XXXXX` / `PAT-XXXXX`).
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
      errors.email = "Email or unique ID is required.";
    }

    if (!password) {
      errors.password = "Password is required.";
    }

    return errors;
  }

  async function signIn(identifier: string, secret: string): Promise<void> {
    setFormError(null);
    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: identifier.trim(),
          password: secret,
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

  async function handleSubmit(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (isSubmitting) return;

    const errors = validate();
    setFieldErrors(errors);
    if (errors.email || errors.password) return;

    await signIn(email, password);
  }

  async function handleDemoSignIn(account: DemoAccount): Promise<void> {
    if (isSubmitting) return;

    setEmail(account.email);
    setPassword(DEMO_ACCOUNT_PASSWORD);
    setShowPassword(false);
    await signIn(account.email, DEMO_ACCOUNT_PASSWORD);
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-6 sm:p-8">
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Demo access
            </p>
            <p className="text-[0.6875rem] text-ink-subtle">
              Password:{" "}
              <span className="font-medium text-ink-muted">
                {DEMO_ACCOUNT_PASSWORD}
              </span>
            </p>
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2">
            {DEMO_ACCOUNTS.map((account) => {
              const Icon = DEMO_ACCOUNT_ICONS[account.role] ?? IconUser;
              return (
                <button
                  key={account.role}
                  type="button"
                  onClick={() => void handleDemoSignIn(account)}
                  disabled={isSubmitting}
                  title={`Sign in as ${account.label} (${account.email})`}
                  className="group flex min-w-0 items-center gap-2.5 rounded-control border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-primary/50 hover:bg-primary-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-55 last:col-span-2"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-light text-primary-active transition-colors group-hover:bg-primary-muted dark:bg-primary/10 dark:text-brand-300">
                    <Icon className="size-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium text-ink">
                      {account.label}
                    </span>
                    <span className="block truncate text-[0.6875rem] text-ink-subtle">
                      {account.email}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="my-5 flex items-center gap-3 text-[0.6875rem] font-medium uppercase tracking-wider text-ink-subtle">
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
          or sign in manually
          <span aria-hidden="true" className="h-px flex-1 bg-border" />
        </div>

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
            label="Email or Unique ID"
            name="email"
            type="text"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            autoFocus
            placeholder="you@clinic.com or DOC-XXXXX"
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
