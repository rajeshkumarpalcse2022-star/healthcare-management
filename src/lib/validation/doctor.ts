import { z } from "zod";

import { APPOINTMENT_MAX_CLINICS_PER_DOCTOR } from "@/config/appointments";
import { DOCTOR_GENDERS, STATUS_FILTERS } from "@/config/doctors";
import {
  codeSchema,
  emailSchema,
  objectIdSchema,
  optionalImageUrlSchema,
  optionalPhoneSchema,
  optionalText,
  paginationSchema,
  requiredText,
} from "./common";

/**
 * Request validation for the doctor endpoints.
 *
 * Mirrors the clinic approach: shared isomorphic schemas run on the client
 * for UX and again on the server for enforcement. Authentication fields are
 * intentionally absent - passwords live only in the User model.
 */

const specializationSchema = z
  .string("Specialization is required.")
  .trim()
  .min(2, "Specialization must be at least 2 characters.")
  .max(80, "Specialization must be 80 characters or fewer.");

/** Experience in whole years, 0-60. */
const experienceYearsSchema = z.coerce
  .number("Enter a valid number of years.")
  .int("Experience must be a whole number of years.")
  .min(0, "Experience cannot be negative.")
  .max(60, "Experience cannot exceed 60 years.");

/** Consultation fee in local currency units; must not be negative. */
const consultationFeeSchema = z.coerce
  .number("Enter a valid consultation fee.")
  .min(0, "Consultation fee cannot be negative.")
  .max(1_000_000, "Consultation fee is too high.");

/** Date of birth; blank collapses to null, future dates rejected. */
const optionalDateOfBirthSchema = z
  .string()
  .trim()
  .refine(
    (value) => value.length === 0 || !Number.isNaN(Date.parse(value)),
    "Enter a valid date of birth.",
  )
  .transform((value) =>
    value.length > 0 ? new Date(value) : null,
  )
  .refine(
    (date) => date === null || date.getTime() <= Date.now(),
    "Date of birth cannot be in the future.",
  )
  .nullable()
  .optional();

/** Additional clinics; the primary `clinicId` is merged by the server. */
const clinicIdsSchema = z
  .array(objectIdSchema)
  .min(1, "Select at least one clinic.")
  .max(
    APPOINTMENT_MAX_CLINICS_PER_DOCTOR,
    `A doctor can be assigned to at most ${APPOINTMENT_MAX_CLINICS_PER_DOCTOR} clinics.`,
  )
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Clinic assignments must not contain duplicates.",
  );

/** Create payload - identity and clinic assignment are mandatory. */
export const doctorCreateSchema = z.object({
  name: requiredText(2, 120, "Doctor name"),
  email: emailSchema,
  phone: optionalPhoneSchema,
  specialization: specializationSchema,
  clinicId: objectIdSchema,
  clinicIds: clinicIdsSchema.optional(),
  doctorCode: codeSchema,
  qualification: optionalText(160, "Qualification"),
  registrationNumber: optionalText(64, "Registration number"),
  experienceYears: experienceYearsSchema.optional(),
  consultationFee: consultationFeeSchema.optional(),
  gender: z.enum(DOCTOR_GENDERS).optional(),
  dateOfBirth: optionalDateOfBirthSchema,
  bio: optionalText(1000, "Bio"),
  profileImageUrl: optionalImageUrlSchema,
});

export type DoctorCreateInput = z.infer<typeof doctorCreateSchema>;

/**
 * Update payload - every field optional.
 *
 * `email` is validated whenever the key is present (blank or malformed values
 * are rejected - the doctor record always carries a contact email). Omit the
 * key to leave the stored email unchanged. `clinicId` reassignment is
 * validated against the clinic store on the server.
 */
export const doctorUpdateSchema = z.object({
  name: requiredText(2, 120, "Doctor name").optional(),
  email: emailSchema.optional(),
  phone: optionalPhoneSchema,
  specialization: specializationSchema.optional(),
  clinicId: objectIdSchema.optional(),
  clinicIds: clinicIdsSchema.optional(),
  doctorCode: codeSchema.optional(),
  qualification: optionalText(160, "Qualification"),
  registrationNumber: optionalText(64, "Registration number"),
  experienceYears: experienceYearsSchema.optional(),
  consultationFee: consultationFeeSchema.optional(),
  gender: z.enum(DOCTOR_GENDERS).optional(),
  dateOfBirth: optionalDateOfBirthSchema,
  bio: optionalText(1000, "Bio"),
  profileImageUrl: optionalImageUrlSchema,
  /**
   * Login-account link: omit to leave unchanged, `null` to unlink, or an id
   * to link (validated on the server against the User store - the account
   * must be an active DOCTOR-role login not already linked elsewhere).
   * Only accepted through the admin PATCH.
   */
  userId: objectIdSchema.nullable().optional(),
});

export type DoctorUpdateInput = z.infer<typeof doctorUpdateSchema>;

/**
 * Doctor self-service profile update (`PATCH /api/doctors/me`).
 *
 * A doctor may edit their own professional details only. Administrative
 * fields - clinic assignment, doctor code, login-account link and active
 * status - are deliberately excluded and remain managed by SUPER_ADMIN /
 * ADMIN. Unknown keys are stripped by Zod, so a crafted request cannot smuggle
 * one of those fields through this endpoint.
 */
export const doctorSelfUpdateSchema = doctorUpdateSchema.pick({
  name: true,
  email: true,
  phone: true,
  specialization: true,
  qualification: true,
  registrationNumber: true,
  experienceYears: true,
  consultationFee: true,
  gender: true,
  dateOfBirth: true,
  bio: true,
  profileImageUrl: true,
});

export type DoctorSelfUpdateInput = z.infer<typeof doctorSelfUpdateSchema>;

/** Status toggle payload. */
export const doctorStatusSchema = z.object({
  isActive: z.boolean("isActive must be a boolean."),
});

export type DoctorStatusInput = z.infer<typeof doctorStatusSchema>;

/** List query parameters: search + filters + pagination. */
export const doctorListQuerySchema = z.object({
  search: z.string().trim().max(120, "Search term is too long.").optional(),
  specialization: z
    .string()
    .trim()
    .max(80, "Specialization filter is too long.")
    .optional(),
  clinic: objectIdSchema.optional(),
  status: z.enum(STATUS_FILTERS).default("all"),
  ...paginationSchema.shape,
});

export type DoctorListQuery = z.infer<typeof doctorListQuerySchema>;

/** Path param validation for `/api/doctors/[id]`. */
export const doctorIdSchema = z.object({
  id: objectIdSchema,
});
