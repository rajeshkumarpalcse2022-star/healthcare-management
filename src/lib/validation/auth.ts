import { z } from "zod";

import type { AuthFieldIssue } from "@/types/auth";

/**
 * Request validation for the authentication endpoints.
 */

/** Login payload. `next` is an optional post-login redirect target. */
export const loginSchema = z.object({
  email: z
    .email("Enter a valid email address.")
    .max(254, "Email address is too long."),
  password: z
    .string("Password is required.")
    .min(1, "Password is required.")
    .max(128, "Password is too long."),
  rememberMe: z.boolean().default(false),
  next: z.string().max(1024).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** Self-registration is limited to these roles. */
export const PUBLIC_SIGNUP_ROLES = ["PATIENT", "DOCTOR"] as const;

export type PublicSignupRole = (typeof PUBLIC_SIGNUP_ROLES)[number];

/** Registration payload. `role` is constrained to publicly sign-up-able roles. */
export const registerSchema = z
  .object({
    name: z
      .string("Name is required.")
      .trim()
      .min(2, "Name must be at least 2 characters.")
      .max(120, "Name is too long."),
    email: z
      .string("Enter a valid email address.")
      .trim()
      .email("Enter a valid email address.")
      .max(254, "Email address is too long."),
    phone: z
      .string()
      .trim()
      .max(20, "Phone number is too long.")
      .optional()
      .or(z.literal("")),
    password: z
      .string("Password is required.")
      .min(8, "Password must be at least 8 characters.")
      .max(128, "Password is too long."),
    confirmPassword: z
      .string("Please confirm your password.")
      .min(1, "Please confirm your password."),
    role: z.enum(PUBLIC_SIGNUP_ROLES, {
      message: "Choose either Patient or Doctor to sign up.",
    }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type RegisterInput = z.infer<typeof registerSchema>;

/** Canonical email form used for lookups and storage. */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Maps Zod issues to `{ field, message }` pairs the client can attach to the
 * right inputs. Messages never reveal whether an account exists.
 */
export function toFieldIssues(error: z.ZodError): AuthFieldIssue[] {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "form",
    message: issue.message,
  }));
}

/**
 * Validates an untrusted post-login redirect target.
 *
 * Only same-origin absolute paths are allowed: no scheme-relative (`//host`),
 * no backslash tricks, no API routes. Returns `null` when unusable so callers
 * fall back to the dashboard.
 */
export function sanitizeNextPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) {
    return null;
  }
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.startsWith("/\\")) return null;
  if (value.startsWith("/api")) return null;
  return value;
}
