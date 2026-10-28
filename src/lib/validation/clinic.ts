import { z } from "zod";

import { STATUS_FILTERS } from "@/config/doctors";
import {
  codeSchema,
  objectIdSchema,
  optionalEmailSchema,
  optionalImageUrlSchema,
  optionalLatitudeSchema,
  optionalLongitudeSchema,
  optionalPhoneSchema,
  optionalPincodeSchema,
  optionalText,
  paginationSchema,
  requiredText,
} from "./common";

/**
 * Request validation for the clinic endpoints.
 *
 * Used twice per write: once in the browser for instant feedback and again on
 * the server, which is the only place that actually enforces the rules.
 */

/** Create payload - name and code are mandatory; contact details optional. */
export const clinicCreateSchema = z.object({
  name: requiredText(2, 120, "Clinic name"),
  code: codeSchema,
  phone: optionalPhoneSchema,
  email: optionalEmailSchema,
  address: optionalText(240, "Address"),
  city: optionalText(80, "City"),
  state: optionalText(80, "State"),
  pincode: optionalPincodeSchema,
  registrationNumber: optionalText(64, "Registration number"),
  imageUrl: optionalImageUrlSchema,
  latitude: optionalLatitudeSchema,
  longitude: optionalLongitudeSchema,
});

export type ClinicCreateInput = z.infer<typeof clinicCreateSchema>;

/** Update payload - every field optional; omit a key to leave it unchanged. */
export const clinicUpdateSchema = z.object({
  name: requiredText(2, 120, "Clinic name").optional(),
  code: codeSchema.optional(),
  phone: optionalPhoneSchema,
  email: optionalEmailSchema,
  address: optionalText(240, "Address"),
  city: optionalText(80, "City"),
  state: optionalText(80, "State"),
  pincode: optionalPincodeSchema,
  registrationNumber: optionalText(64, "Registration number"),
  imageUrl: optionalImageUrlSchema,
  latitude: optionalLatitudeSchema,
  longitude: optionalLongitudeSchema,
});

export type ClinicUpdateInput = z.infer<typeof clinicUpdateSchema>;

/**
 * Fields a DOCTOR may update on the clinic assigned to their own profile.
 * Clinic code, active status and assignment remain administrator-managed.
 */
export const doctorClinicUpdateSchema = clinicUpdateSchema.pick({
  name: true,
  phone: true,
  email: true,
  address: true,
  city: true,
  state: true,
  pincode: true,
  registrationNumber: true,
  imageUrl: true,
  latitude: true,
  longitude: true,
});

export type DoctorClinicUpdateInput = z.infer<typeof doctorClinicUpdateSchema>;

/** Status toggle payload. */
export const clinicStatusSchema = z.object({
  isActive: z.boolean("isActive must be a boolean."),
});

export type ClinicStatusInput = z.infer<typeof clinicStatusSchema>;

/** List query parameters: search + status + pagination. */
export const clinicListQuerySchema = z.object({
  search: z.string().trim().max(120, "Search term is too long.").optional(),
  status: z.enum(STATUS_FILTERS).default("all"),
  ...paginationSchema.shape,
});

export type ClinicListQuery = z.infer<typeof clinicListQuerySchema>;

/** Path param validation for `/api/clinics/[id]`. */
export const clinicIdSchema = z.object({
  id: objectIdSchema,
});
