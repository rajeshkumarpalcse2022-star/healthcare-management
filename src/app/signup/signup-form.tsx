"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  IconAlertTriangle,
  IconEye,
  IconEyeOff,
  IconLock,
  IconMail,
  IconUser,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getDashboardRouteForRole } from "@/config/auth";
import type { AuthErrorBody, RegisterSuccessBody } from "@/types/auth";

interface FieldErrors {
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  confirmPassword?: string;
  role?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Client registration form.
 *
 * Performs light required/format checks for responsiveness only - the server
 * revalidates everything with Zod and is the source of truth for the result.
 * The role select is limited to PATIENT and DOCTOR; privileged management
 * roles cannot be chosen here.
 */
export function SignupForm() {
  const router = useRouter();

  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [role, setRole] = React.useState("PATIENT");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);

  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();

    if (!trimmedName) {
      errors.name = "Name is required.";
    } else if (trimmedName.length < 2) {
      errors.name = "Name must be at least 2 characters.";
    }

    if (!trimmedEmail) {
      errors.email = "Email is required.";
    } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
      errors.email = "Enter a valid email address.";
    }

    if (!password) {
      errors.password = "Password is required.";
    } else if (password.length < 8) {
      errors.password = "Password must be at least 8 characters.";
    }

    if (!confirmPassword) {
      errors.confirmPassword = "Please confirm your password.";
    } else if (password !== confirmPassword) {
      errors.confirmPassword = "Passwords do not match.";
    }

    if (role !== "PATIENT" && role !== "DOCTOR") {
      errors.role = "Choose either Patient or Doctor to sign up.";
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
    if (Object.keys(errors).length > 0) return;

    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          password,
          confirmPassword,
          role,
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | RegisterSuccessBody
        | AuthErrorBody
        | null;

      if (response.ok && data && data.success) {
        router.push(getDashboardRouteForRole(data.user.role));
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
          if (
            issue.field === "name" ||
            issue.field === "email" ||
            issue.field === "phone" ||
            issue.field === "password" ||
            issue.field === "confirmPassword" ||
            issue.field === "role"
          ) {
            mapped[issue.field] = issue.message;
          }
        }
        setFieldErrors(mapped);
        if (Object.keys(mapped).length === 0) {
          setFormError(data.error);
        }
        return;
      }

      setFormError(
        data && !data.success
          ? data.error
          : "Unable to create your account right now. Please try again.",
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
            label="Full name"
            name="name"
            type="text"
            autoComplete="name"
            required
            autoFocus
            placeholder="Jane Doe"
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={fieldErrors.name}
            icon={<IconUser className="size-4" />}
            disabled={isSubmitting}
          />

          <Input
            label="Email address"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            placeholder="you@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={fieldErrors.email}
            icon={<IconMail className="size-4" />}
            disabled={isSubmitting}
          />

          <Input
            label="Phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            placeholder="Optional"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            error={fieldErrors.phone}
            disabled={isSubmitting}
          />

          <Select
            label="I am signing up as"
            name="role"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            error={fieldErrors.role}
            disabled={isSubmitting}
            options={[
              { value: "PATIENT", label: "Patient" },
              { value: "DOCTOR", label: "Doctor" },
            ]}
            hint="Doctor accounts require clinic affiliation approval before full access."
          />

          <Input
            label="Password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            placeholder="At least 8 characters"
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

          <Input
            label="Confirm password"
            name="confirmPassword"
            type={showConfirm ? "text" : "password"}
            autoComplete="new-password"
            required
            placeholder="Re-enter your password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            error={fieldErrors.confirmPassword}
            icon={<IconLock className="size-4" />}
            disabled={isSubmitting}
            trailing={
              <button
                type="button"
                onClick={() => setShowConfirm((value) => !value)}
                aria-label={
                  showConfirm ? "Hide password" : "Show password"
                }
                aria-pressed={showConfirm}
                tabIndex={-1}
                className="rounded-md p-1.5 text-ink-subtle transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              >
                {showConfirm ? (
                  <IconEyeOff className="size-4" />
                ) : (
                  <IconEye className="size-4" />
                )}
              </button>
            }
          />

          <Button
            type="submit"
            className="w-full"
            size="lg"
            loading={isSubmitting}
          >
            Create account
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
