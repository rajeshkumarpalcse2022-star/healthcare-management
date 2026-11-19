"use client";

import * as React from "react";

import {
  IconAlertTriangle,
  IconEye,
  IconEyeOff,
  IconLock,
  IconShieldCheck,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiSend, ApiRequestError } from "@/lib/api/client";
import type { ChangeCredentialsSuccessBody } from "@/types/auth";

interface FieldErrors {
  currentPassword?: string;
  newUniqueId?: string;
  newPassword?: string;
  confirmNewPassword?: string;
}

export interface ChangeCredentialsCardProps {
  /** Current unique ID - shown read-only so the user knows the format. */
  currentUniqueId?: string;
  onUpdated?: () => void;
}

/**
 * Optional credentials self-service for doctor / laboratory accounts.
 *
 * Changing is never mandatory - the admin-issued credentials keep working
 * until the owner chooses to replace them. The current password is always
 * required as proof of possession.
 */
export function ChangeCredentialsCard({
  currentUniqueId,
  onUpdated,
}: ChangeCredentialsCardProps) {
  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newUniqueId, setNewUniqueId] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmNewPassword, setConfirmNewPassword] = React.useState("");
  const [showCurrent, setShowCurrent] = React.useState(false);
  const [showNew, setShowNew] = React.useState(false);
  const [showConfirm, setShowConfirm] = React.useState(false);

  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  function validate(): FieldErrors {
    const next: FieldErrors = {};
    if (!currentPassword) {
      next.currentPassword = "Enter your current password.";
    }
    if (!newUniqueId.trim() && !newPassword) {
      next.newUniqueId = "Provide a new unique ID or a new password.";
    }
    if (newPassword && newPassword.length < 8) {
      next.newPassword = "New password must be at least 8 characters.";
    }
    if (newPassword && newPassword !== confirmNewPassword) {
      next.confirmNewPassword = "Passwords do not match.";
    }
    return next;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    setFormError(null);
    setSuccessMessage(null);

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSubmitting(true);
    try {
      const result = await apiSend<ChangeCredentialsSuccessBody>(
        "/api/auth/change-credentials",
        "POST",
        {
          currentPassword,
          ...(newUniqueId.trim() ? { newUniqueId: newUniqueId.trim() } : {}),
          ...(newPassword ? { newPassword, confirmNewPassword } : {}),
        },
      );

      if (result.success) {
        setSuccessMessage("Credentials updated successfully.");
        setCurrentPassword("");
        setNewUniqueId("");
        setNewPassword("");
        setConfirmNewPassword("");
        setErrors({});
        onUpdated?.();
      }
    } catch (error) {
      if (error instanceof ApiRequestError) {
        const mapped: FieldErrors = {};
        for (const issue of error.issues ?? []) {
          if (
            issue.field === "currentPassword" ||
            issue.field === "newUniqueId" ||
            issue.field === "newPassword" ||
            issue.field === "confirmNewPassword"
          ) {
            mapped[issue.field] = issue.message;
          }
        }
        setErrors(mapped);
        if (Object.keys(mapped).length === 0) setFormError(error.message);
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconShieldCheck className="size-4 text-primary" />
          Login credentials
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-ink-muted">
          You are currently signed in with{" "}
          {currentUniqueId ? (
            <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs font-semibold text-ink">
              {currentUniqueId}
            </code>
          ) : (
            "your email"
          )}{" "}
          and your password. Changing these is optional - your current
          credentials keep working until you update them.
        </p>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          {formError ? (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-control border border-danger-line bg-danger-soft px-3.5 py-3 text-sm font-medium text-danger"
            >
              <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
              <p className="min-w-0 leading-relaxed">{formError}</p>
            </div>
          ) : null}

          {successMessage ? (
            <div
              role="status"
              className="rounded-control border border-success-line bg-success-soft px-3.5 py-3 text-sm font-medium text-success"
            >
              {successMessage}
            </div>
          ) : null}

          <Input
            label="Current password"
            name="currentPassword"
            type={showCurrent ? "text" : "password"}
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            error={errors.currentPassword}
            icon={<IconLock className="size-4" />}
            disabled={submitting}
            trailing={
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                aria-label={showCurrent ? "Hide password" : "Show password"}
                tabIndex={-1}
                className="rounded-md p-1.5 text-ink-subtle transition-colors hover:text-ink"
              >
                {showCurrent ? (
                  <IconEyeOff className="size-4" />
                ) : (
                  <IconEye className="size-4" />
                )}
              </button>
            }
          />

          <Input
            label="New unique ID (optional)"
            name="newUniqueId"
            type="text"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder={currentUniqueId ?? "DOC-XXXXX"}
            value={newUniqueId}
            onChange={(event) => setNewUniqueId(event.target.value.toUpperCase())}
            error={errors.newUniqueId}
            disabled={submitting}
            hint="Leave blank to keep your current ID."
          />

          <Input
            label="New password (optional)"
            name="newPassword"
            type={showNew ? "text" : "password"}
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            error={errors.newPassword}
            icon={<IconLock className="size-4" />}
            disabled={submitting}
            hint="Leave blank to keep your current password."
            trailing={
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                aria-label={showNew ? "Hide password" : "Show password"}
                tabIndex={-1}
                className="rounded-md p-1.5 text-ink-subtle transition-colors hover:text-ink"
              >
                {showNew ? (
                  <IconEyeOff className="size-4" />
                ) : (
                  <IconEye className="size-4" />
                )}
              </button>
            }
          />

          {newPassword ? (
            <Input
              label="Confirm new password"
              name="confirmNewPassword"
              type={showConfirm ? "text" : "password"}
              autoComplete="new-password"
              placeholder="Re-enter new password"
              value={confirmNewPassword}
              onChange={(event) => setConfirmNewPassword(event.target.value)}
              error={errors.confirmNewPassword}
              icon={<IconLock className="size-4" />}
              disabled={submitting}
              trailing={
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  aria-label={showConfirm ? "Hide password" : "Show password"}
                  tabIndex={-1}
                  className="rounded-md p-1.5 text-ink-subtle transition-colors hover:text-ink"
                >
                  {showConfirm ? (
                    <IconEyeOff className="size-4" />
                  ) : (
                    <IconEye className="size-4" />
                  )}
                </button>
              }
            />
          ) : null}

          <Button type="submit" loading={submitting}>
            Update credentials
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
