import { z } from "zod";

import { PROVISIONABLE_ROLES } from "@/config/roles";
import {
  emailSchema,
  objectIdSchema,
  optionalPhoneSchema,
  paginationSchema,
  requiredText,
} from "@/lib/validation/common";

/**
 * Validation for the user-administration API surface: the SA/ADMIN account
 * provisioning endpoints (`POST /api/users`, `PATCH /api/users/[id]`) and the
 * laboratory-assignment surface (`GET /api/users`,
 * `PATCH /api/users/[id]/laboratory-scope`).
 *
 * Shared by the server routes and the client form - the same schemas run in
 * the browser for instant feedback and again on the server for enforcement.
 */

/** Upper bound on how many laboratories one account may be assigned to. */
export const MAX_SCOPED_LABORATORIES = 100;

/** Cap on the embedded `laboratoryScopeHistory` audit trail (newest kept). */
export const SCOPE_HISTORY_CAP = 50;

/**
 * `PATCH /api/users/[id]/laboratory-scope` body: the complete replacement
 * scope (not a delta). Duplicates are rejected rather than silently merged
 * so the caller always sends an intentional, clean set.
 */
export const userScopeUpdateSchema = z.object({
  laboratoryIds: z
    .array(objectIdSchema, "Select valid laboratories to assign.")
    .max(
      MAX_SCOPED_LABORATORIES,
      `At most ${MAX_SCOPED_LABORATORIES} laboratories can be assigned.`,
    )
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "Remove duplicate laboratories before saving.",
    ),
});

export type UserScopeUpdate = z.infer<typeof userScopeUpdateSchema>;

/**
 * `GET /api/users` list query: server-side search over name/email, an
 * optional exact role filter, and the shared pagination bounds.
 */
export const userListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120, "Search term is too long.").optional(),
  role: z
    .string()
    .trim()
    .max(40)
    .regex(/^[A-Z_]+$/, "Invalid role filter.")
    .optional(),
});

/** Role enum restricted to administrator-provisionable roles. */
const provisionableRoleSchema = z.enum(PROVISIONABLE_ROLES, {
  message: "Choose a provisionable role.",
});

/**
 * `POST /api/users` body: create a privileged account. The password follows
 * the same policy as public registration; `confirmPassword` is part of the
 * contract so the client form and the server agree on the shape.
 */
export const userCreateSchema = z
  .object({
    name: requiredText(2, 120, "Name"),
    email: emailSchema,
    phone: optionalPhoneSchema,
    password: z
      .string("Password is required.")
      .min(8, "Password must be at least 8 characters.")
      .max(128, "Password is too long."),
    confirmPassword: z
      .string("Please confirm your password.")
      .min(1, "Please confirm your password."),
    role: provisionableRoleSchema,
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type UserCreateInput = z.infer<typeof userCreateSchema>;

/**
 * `PATCH /api/users/[id]` body: partial update. Every key is optional - an
 * omitted key leaves the stored value unchanged. At least one key must be
 * present. `SUPER_ADMIN` is not provisionable, so a role change can never
 * grant it.
 */
export const userPatchSchema = z
  .object({
    name: requiredText(2, 120, "Name").optional(),
    email: emailSchema.optional(),
    phone: optionalPhoneSchema,
    role: provisionableRoleSchema.optional(),
    isActive: z.boolean().optional(),
  })
  .refine(
    (data) => Object.values(data).some((value) => value !== undefined),
    "Provide at least one field to update.",
  );

export type UserPatchInput = z.infer<typeof userPatchSchema>;
