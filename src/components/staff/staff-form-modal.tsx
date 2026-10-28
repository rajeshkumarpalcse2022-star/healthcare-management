"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { PROVISIONABLE_ROLES, ROLE_LABELS } from "@/config/roles";
import { ApiRequestError, apiSend } from "@/lib/api/client";
import { toFieldIssues } from "@/lib/validation/common";
import {
  userCreateSchema,
  userPatchSchema,
} from "@/lib/validation/user-scope";
import type { ItemResponse } from "@/types/api";
import type { SafeUser } from "@/types/auth";

type FieldErrors = Record<string, string>;

interface FormValues {
  name: string;
  email: string;
  phone: string;
  role: string;
  /** Create mode only. */
  password: string;
  confirmPassword: string;
  /** Edit mode only. */
  isActive: boolean;
}

const ROLE_OPTIONS = PROVISIONABLE_ROLES.map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

function toFormValues(user?: SafeUser | null): FormValues {
  if (!user) {
    return {
      name: "",
      email: "",
      phone: "",
      role: "",
      password: "",
      confirmPassword: "",
      isActive: true,
    };
  }
  return {
    name: user.name,
    email: user.email,
    phone: user.phone ?? "",
    role: user.role,
    password: "",
    confirmPassword: "",
    isActive: user.isActive,
  };
}

export interface StaffFormModalProps {
  open: boolean;
  onClose: () => void;
  /** `null` / omitted → create mode. */
  user?: SafeUser | null;
  onSaved: (user: SafeUser) => void;
}

/**
 * Create / edit privileged account dialog (SUPER_ADMIN / ADMIN only).
 *
 * Create mode posts `POST /api/users`; edit mode patches `PATCH
 * /api/users/[id]`. The shared Zod schema runs in the browser for instant
 * feedback and again on the server for enforcement. The submit button locks
 * while a request is in flight so a double click cannot create a duplicate.
 */
export function StaffFormModal({
  open,
  onClose,
  user,
  onSaved,
}: StaffFormModalProps) {
  const isEdit = Boolean(user);
  const { success: showSuccess } = useToast();
  const [values, setValues] = React.useState<FormValues>(() =>
    toFormValues(user),
  );
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Reset the form whenever the dialog opens. Render-phase adjustment keeps
  // stale values from the previous record from leaking into the next edit.
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setValues(toFormValues(user));
      setErrors({});
      setFormError(null);
      setSubmitting(false);
    }
  }

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const payload: Record<string, unknown> = isEdit
      ? {
          name: values.name,
          email: values.email,
          phone: values.phone,
          role: values.role,
          isActive: values.isActive,
        }
      : {
          name: values.name,
          email: values.email,
          phone: values.phone,
          role: values.role,
          password: values.password,
          confirmPassword: values.confirmPassword,
        };
    const parsed = (isEdit ? userPatchSchema : userCreateSchema).safeParse(
      payload,
    );

    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of toFieldIssues(parsed.error)) {
        next[issue.field] = issue.message;
      }
      setErrors(next);
      setFormError(null);
      return;
    }

    setSubmitting(true);
    setErrors({});
    setFormError(null);

    try {
      const url = isEdit ? `/api/users/${user!.id}` : "/api/users";
      const method = isEdit ? "PATCH" : "POST";
      const result = await apiSend<ItemResponse<SafeUser>>(
        url,
        method,
        parsed.data,
      );
      const scopedRole =
        result.data.role === "LAB_MANAGER" || result.data.role === "STAFF";
      showSuccess(
        isEdit ? "Account updated" : "Account created",
        isEdit
          ? `${result.data.name} has been saved.`
          : scopedRole
            ? `${result.data.name} starts with no laboratory access. Assign laboratories under Administration → Staff Access.`
            : `${result.data.name} can now sign in.`,
      );
      onSaved(result.data);
      onClose();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        const next: FieldErrors = {};
        for (const issue of error.issues ?? []) {
          next[issue.field] = issue.message;
        }
        setErrors(next);
        setFormError(error.message);
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title={isEdit ? "Edit account" : "Create account"}
      description={
        isEdit
          ? "Update the account details below."
          : "Provision a new privileged account. The user signs in with the password you set."
      }
      dismissible={!submitting}
      footer={
        <>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="submit" form="staff-account-form" loading={submitting}>
            {isEdit ? "Save changes" : "Create account"}
          </Button>
        </>
      }
    >
      <form id="staff-account-form" onSubmit={handleSubmit} noValidate>
        {formError ? (
          <div
            role="alert"
            className="mb-4 rounded-control border border-danger-line bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
          >
            {formError}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Full name"
            name="name"
            required
            autoComplete="name"
            value={values.name}
            onChange={(event) => update("name", event.target.value)}
            error={errors.name}
            containerClassName="sm:col-span-2"
          />

          <Input
            label="Email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={values.email}
            onChange={(event) => update("email", event.target.value)}
            error={errors.email}
          />

          <Input
            label="Phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            value={values.phone}
            onChange={(event) => update("phone", event.target.value)}
            error={errors.phone}
            placeholder="+91 98765 43210"
          />

          <Select
            label="Role"
            name="role"
            required
            placeholder="Choose a role"
            value={values.role}
            onChange={(event) => update("role", event.target.value)}
            options={ROLE_OPTIONS}
            error={errors.role}
            hint={
              isEdit
                ? "Super admin accounts cannot be granted here."
                : "Lab manager and staff accounts start with no laboratory access."
            }
            containerClassName="sm:col-span-2"
          />

          {isEdit ? (
            <label className="flex cursor-pointer items-center gap-2.5 sm:col-span-2">
              <input
                type="checkbox"
                name="is-active"
                checked={values.isActive}
                onChange={(event) => update("isActive", event.target.checked)}
                disabled={submitting}
                className="size-4 rounded-xs border-border text-primary accent-primary"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">
                  Account is active
                </span>
                <span className="block text-xs text-ink-muted">
                  Disabled accounts cannot sign in and lose their session.
                </span>
              </span>
            </label>
          ) : (
            <>
              <Input
                label="Password"
                name="password"
                type="password"
                required
                autoComplete="new-password"
                value={values.password}
                onChange={(event) => update("password", event.target.value)}
                error={errors.password}
                hint="At least 8 characters."
              />

              <Input
                label="Confirm password"
                name="confirmPassword"
                type="password"
                required
                autoComplete="new-password"
                value={values.confirmPassword}
                onChange={(event) =>
                  update("confirmPassword", event.target.value)
                }
                error={errors.confirmPassword}
              />
            </>
          )}
        </div>
      </form>
    </Modal>
  );
}
