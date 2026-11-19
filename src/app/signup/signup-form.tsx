"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  IconAlertTriangle,
  IconChevronLeft,
  IconEye,
  IconEyeOff,
  IconLock,
  IconMail,
  IconUser,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type {
  AuthErrorBody,
  OtpSendSuccessBody,
  OtpVerifySuccessBody,
} from "@/types/auth";

interface FieldErrors {
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  confirmPassword?: string;
  otp?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OTP_PATTERN = /^\d{6}$/;

type Step = "details" | "otp";

/**
 * Client registration form for patients.
 *
 * Step 1 collects details and requests an OTP via email. Step 2 verifies the
 * OTP and creates the account (server issues the session cookie). The server
 * revalidates everything with Zod and is the source of truth for the result.
 */
export function SignupForm() {
  const router = useRouter();

  const [step, setStep] = React.useState<Step>("details");
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [otp, setOtp] = React.useState("");
  const [resendIn, setResendIn] = React.useState(0);

  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isSendingOtp, setIsSendingOtp] = React.useState(false);

  // Resend countdown ticker.
  const resendActive = resendIn > 0;
  React.useEffect(() => {
    if (!resendActive) return;
    const timer = window.setInterval(() => {
      setResendIn((value) => (value <= 1 ? 0 : value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendActive]);

  function validateDetails(): FieldErrors {
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

    return errors;
  }

  async function requestOtp(): Promise<void> {
    setFormError(null);
    const errors = validateDetails();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsSendingOtp(true);
    try {
      const response = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      const data = (await response.json().catch(() => null)) as
        | OtpSendSuccessBody
        | AuthErrorBody
        | null;

      if (response.ok && data && data.success) {
        setStep("otp");
        setOtp("");
        setFieldErrors({});
        setResendIn(Math.min(data.expiresInSeconds, 60));
        return;
      }

      setFormError(
        data && !data.success
          ? data.error
          : "Unable to send the verification code. Please try again.",
      );
    } catch {
      setFormError(
        "Unable to reach the server. Check your connection and try again.",
      );
    } finally {
      setIsSendingOtp(false);
    }
  }

  async function verifyOtpAndCreate(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (isSubmitting) return;

    setFormError(null);

    if (!OTP_PATTERN.test(otp.trim())) {
      setFieldErrors({ otp: "Enter the 6-digit verification code." });
      return;
    }
    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || undefined,
          password,
          confirmPassword,
          role: "PATIENT",
          otp: otp.trim(),
        }),
      });

      const data = (await response.json().catch(() => null)) as
        | OtpVerifySuccessBody
        | AuthErrorBody
        | null;

      if (response.ok && data && data.success) {
        router.push(data.redirectTo || "/patient/dashboard");
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
          if (issue.field === "otp") mapped.otp = issue.message;
        }
        setFieldErrors(mapped);
        if (!mapped.otp) setFormError(data.error);
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

  function goBackToDetails(): void {
    if (isSubmitting) return;
    setStep("details");
    setOtp("");
    setFormError(null);
    setFieldErrors({});
  }

  if (step === "otp") {
    return (
      <Card className="overflow-hidden">
        <CardContent className="p-6 sm:p-8">
          <form
            onSubmit={verifyOtpAndCreate}
            noValidate
            className="space-y-5"
          >
            {formError ? (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-control border border-danger-line bg-danger-soft px-3.5 py-3 text-sm font-medium text-danger animate-fade-in"
              >
                <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
                <p className="min-w-0 leading-relaxed">{formError}</p>
              </div>
            ) : null}

            <div className="rounded-control border border-border bg-surface-muted px-3.5 py-3 text-sm text-ink-muted">
              We sent a 6-digit code to{" "}
              <span className="font-medium text-ink">{email.trim()}</span>.
              Enter it below to verify your email and create your account.
            </div>

            <Input
              label="Verification code"
              name="otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              autoFocus
              maxLength={6}
              placeholder="000000"
              value={otp}
              onChange={(event) =>
                setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))
              }
              error={fieldErrors.otp}
              disabled={isSubmitting}
              containerClassName="[&_input]:tracking-[0.35em]"
            />

            <Button
              type="submit"
              className="w-full"
              size="lg"
              loading={isSubmitting}
              disabled={otp.length !== 6}
            >
              Verify & create account
            </Button>

            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={goBackToDetails}
                disabled={isSubmitting}
                className="inline-flex items-center gap-1.5 text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
              >
                <IconChevronLeft className="size-3.5" />
                Back
              </button>
              <button
                type="button"
                onClick={() => void requestOtp()}
                disabled={isSendingOtp || resendIn > 0}
                className="font-medium text-brand-700 transition-colors hover:text-brand-800 disabled:opacity-50 dark:text-brand-300 dark:hover:text-brand-200"
              >
                {resendIn > 0
                  ? `Resend in ${resendIn}s`
                  : isSendingOtp
                    ? "Sending..."
                    : "Resend code"}
              </button>
            </div>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-6 sm:p-8">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void requestOtp();
          }}
          noValidate
          className="space-y-5"
        >
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
            disabled={isSendingOtp}
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
            disabled={isSendingOtp}
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
            disabled={isSendingOtp}
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
            disabled={isSendingOtp}
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
            disabled={isSendingOtp}
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
            loading={isSendingOtp}
          >
            Send verification code
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
