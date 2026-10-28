import { z } from "zod";

import { LIST_DEFAULT_LIMIT, LIST_MAX_LIMIT } from "@/config/doctors";
import type { ApiFieldIssue } from "@/types/api";

/**
 * Shared validation primitives for the management APIs.
 *
 * Deliberately free of `server-only` / mongoose imports: the same schemas run
 * in the browser for form UX and again on the server for enforcement.
 *
 * Value contract for optional fields:
 * - omitted / `undefined`  → leave unchanged (update) or use model default
 * - `null` / empty string  → clear the field
 * - non-empty string       → set the value
 */

/** Mongo ObjectId shape check (24 hex chars). Regex only - no mongoose import. */
export const objectIdSchema = z
  .string("This value is required.")
  .trim()
  .regex(/^[0-9a-fA-F]{24}$/, "Invalid id.");

/**
 * Business code format: uppercase letters, digits and single hyphens.
 * Blank is rejected - codes are always required on create.
 */
export const codeSchema = z
  .string("This value is required.")
  .trim()
  .transform((value) => value.replace(/\s+/g, "-").toUpperCase())
  .pipe(
    z
      .string()
      .min(3, "Code must be at least 3 characters.")
      .max(32, "Code must be 32 characters or fewer.")
      .regex(
        /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
        "Use letters, numbers and hyphens only (e.g. CLINIC-01).",
      ),
  );

/** Shared phone shape used by the optional and required phone schemas. */
export const PHONE_PATTERN = /^\+?[0-9][0-9\s\-().]{5,19}$/;

/** Optional phone. Empty input clears the field (`null`); omit to leave unchanged. */
export const optionalPhoneSchema = z
  .string()
  .trim()
  .max(20, "Phone number is too long.")
  .refine(
    (value) => value.length === 0 || PHONE_PATTERN.test(value),
    "Enter a valid phone number.",
  )
  .transform((value) => (value.length > 0 ? value : null))
  .nullable()
  .optional();

/** Optional email. Empty input clears the field; otherwise normalised. */
export const optionalEmailSchema = z
  .string()
  .trim()
  .max(254, "Email address is too long.")
  .refine(
    (value) => value.length === 0 || z.email().safeParse(value).success,
    "Enter a valid email address.",
  )
  .transform((value) =>
    value.length > 0 ? value.trim().toLowerCase() : null,
  )
  .nullable()
  .optional();

/** Required email, normalised to lowercase. */
export const emailSchema = z
  .email("Enter a valid email address.")
  .max(254, "Email address is too long.")
  .transform((value) => value.trim().toLowerCase());

/** Optional postal code (3-10 alphanumeric characters, spaces and hyphens). */
export const optionalPincodeSchema = z
  .string()
  .trim()
  .max(12, "Pincode is too long.")
  .refine(
    (value) =>
      value.length === 0 ||
      /^[A-Za-z0-9][A-Za-z0-9\s-]{1,9}$/.test(value),
    "Enter a valid pincode.",
  )
  .transform((value) => (value.length > 0 ? value : null))
  .nullable()
  .optional();

/** Required postal code (3-10 alphanumeric characters). */
export const pincodeSchema = z
  .string("Pincode is required.")
  .trim()
  .max(12, "Pincode is too long.")
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9\s-]{1,9}$/,
    "Enter a valid pincode.",
  );

/** Optional Cloudinary image URL. Empty input clears the value. */
export const optionalImageUrlSchema = z
  .string()
  .trim()
  .max(800, "Image URL is too long.")
  .refine(
    (value) =>
      value.length === 0 ||
      /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\//.test(value),
    "Upload a valid profile image.",
  )
  .transform((value) => (value.length > 0 ? value : null))
  .nullable()
  .optional();

/** Optional latitude captured from the browser Geolocation API. */
export const optionalLatitudeSchema = z
  .number("Latitude must be a number.")
  .min(-90, "Latitude must be between -90 and 90.")
  .max(90, "Latitude must be between -90 and 90.")
  .nullable()
  .optional();

/** Optional longitude captured from the browser Geolocation API. */
export const optionalLongitudeSchema = z
  .number("Longitude must be a number.")
  .min(-180, "Longitude must be between -180 and 180.")
  .max(180, "Longitude must be between -180 and 180.")
  .nullable()
  .optional();

/** Optional free-text field; blank clears the value. */
export function optionalText(maxLength: number, label: string) {
  return z
    .string()
    .trim()
    .max(maxLength, `${label} must be ${maxLength} characters or fewer.`)
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()
    .optional();
}

/** Required free-text field. */
export function requiredText(
  minLength: number,
  maxLength: number,
  label: string,
) {
  return z
    .string(`${label} is required.`)
    .trim()
    .min(minLength, `${label} must be at least ${minLength} characters.`)
    .max(maxLength, `${label} must be ${maxLength} characters or fewer.`);
}

/** Status filter string → Mongo boolean filter. */
export function statusToBoolean(
  status: string | undefined,
): boolean | undefined {
  if (status === "active") return true;
  if (status === "inactive") return false;
  return undefined;
}

/** Pagination values shared by both list endpoints. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, "Limit must be at least 1.")
    .max(LIST_MAX_LIMIT, `Limit must be ${LIST_MAX_LIMIT} or fewer.`)
    .default(LIST_DEFAULT_LIMIT),
});

/**
 * Maps Zod issues to `{ field, message }` pairs the client can attach to the
 * right inputs. Messages are user-facing and never include internals.
 */
export function toFieldIssues(error: z.ZodError): ApiFieldIssue[] {
  if (!Array.isArray(error.issues)) return [];
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "form",
    message: issue.message,
  }));
}

/** Escapes user input before it is embedded in a MongoDB regular expression. */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive "contains" regex query fragment. */
export function containsRegex(value: string) {
  return { $regex: escapeRegex(value), $options: "i" };
}
