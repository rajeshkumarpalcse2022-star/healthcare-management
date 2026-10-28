import { z } from "zod";

import {
  PATIENT_BLOOD_GROUPS,
  PATIENT_GENDERS,
  PATIENT_NOTES_MAX_LENGTH,
} from "@/config/patients";
import {
  PHONE_PATTERN,
  emailSchema,
  objectIdSchema,
  optionalPhoneSchema,
  optionalText,
  paginationSchema,
  pincodeSchema,
  requiredText,
} from "@/lib/validation/common";

/**
 * Validation for the Patient Management API surface (P1-1): the staff
 * directory (`GET/POST /api/patients`), staff detail edit
 * (`GET/PATCH /api/patients/[id]`, `PATCH /api/patients/[id]/status`) and the
 * patient self-service surface (`GET/PUT /api/patients/me`).
 *
 * Shared by the server routes and the client forms - the same schemas run in
 * the browser for instant feedback and again on the server for enforcement.
 */

/** `YYYY-MM-DD` calendar date (format-level check; conversion is server-side). */
export const patientDateStringSchema = z
  .string("Enter a valid date.")
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const probe = new Date(Date.UTC(year, month - 1, day));
    return (
      probe.getUTCFullYear() === year &&
      probe.getUTCMonth() === month - 1 &&
      probe.getUTCDate() === day
    );
  }, "Enter a valid calendar date.");

const genderSchema = z.enum(PATIENT_GENDERS, {
  message: "Choose a valid gender.",
});

const bloodGroupSchema = z.enum(PATIENT_BLOOD_GROUPS, {
  message: "Choose a valid blood group.",
});

/**
 * Address is all-or-nothing: when present it must be complete (line 1, city,
 * state, pincode) so operational pickup/print flows never see a half-address.
 * `null` clears the field.
 */
export const patientAddressInputSchema = z.object({
  line1: requiredText(1, 160, "Address line 1"),
  line2: optionalText(160, "Address line 2"),
  city: requiredText(1, 80, "City"),
  state: requiredText(1, 80, "State"),
  pincode: pincodeSchema,
});

/** Emergency contact is all-or-nothing for the same reason as the address. */
export const patientEmergencyContactInputSchema = z.object({
  name: requiredText(2, 120, "Contact name"),
  phone: z
    .string("Contact phone is required.")
    .trim()
    .max(20, "Phone number is too long.")
    .regex(PHONE_PATTERN, "Enter a valid phone number."),
  relationship: optionalText(40, "Relationship"),
});

/**
 * Demographic fields shared by staff create, staff edit and patient self-put.
 * Every key is optional and nullable: omitted leaves unchanged (PATCH) or
 * stays null (create); `null` / empty input clears.
 */
export const patientDemographicsSchema = {
  dateOfBirth: patientDateStringSchema.nullable().optional(),
  gender: genderSchema.nullable().optional(),
  bloodGroup: bloodGroupSchema.nullable().optional(),
  address: patientAddressInputSchema.nullable().optional(),
  emergencyContact: patientEmergencyContactInputSchema.nullable().optional(),
};

/**
 * `GET /api/patients` list query: directory search over name/email/phone, an
 * optional record-status filter, and the shared pagination bounds.
 */
export const patientListQuerySchema = paginationSchema.extend({
  search: z.string().trim().max(120, "Search term is too long.").optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

/**
 * `POST /api/patients` body: staff-created patient account + optional
 * demographics in one call. The password is optional - when omitted the
 * server generates a temporary one and returns it exactly once. There is no
 * `confirmPassword` here (unlike privileged provisioning): the field is
 * admin-typed or server-generated, never end-user confirmed in this flow.
 */
export const patientCreateSchema = z.object({
  name: requiredText(2, 120, "Name"),
  email: emailSchema,
  phone: optionalPhoneSchema,
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(128, "Password is too long.")
    .optional(),
  profile: z
    .object({
      ...patientDemographicsSchema,
      notes: optionalText(PATIENT_NOTES_MAX_LENGTH, "Notes"),
    })
    .optional(),
});

export type PatientCreateInput = z.infer<typeof patientCreateSchema>;

/**
 * `PATCH /api/patients/[id]` body (ADMIN / SUPER_ADMIN): partial demographics
 * update plus the record-level `isActive` switch and staff-only notes. An
 * omitted key leaves the stored value unchanged; at least one key required.
 */
export const patientPatchSchema = z
  .object({
    ...patientDemographicsSchema,
    notes: optionalText(PATIENT_NOTES_MAX_LENGTH, "Notes"),
    isActive: z.boolean().optional(),
  })
  .refine(
    (data) => Object.values(data).some((value) => value !== undefined),
    "Provide at least one field to update.",
  );

export type PatientPatchInput = z.infer<typeof patientPatchSchema>;

/**
 * `PUT /api/patients/me` body (patient self-service): demographics only.
 * `notes` and `isActive` are deliberately absent - clinical remarks stay
 * staff-only and record status is an administrator decision.
 */
export const patientSelfPutSchema = z
  .object(patientDemographicsSchema)
  .refine(
    (data) => Object.values(data).some((value) => value !== undefined),
    "Provide at least one field to update.",
  );

export type PatientSelfPutInput = z.infer<typeof patientSelfPutSchema>;

/** `PATCH /api/patients/[id]/status` body. */
export const patientStatusSchema = z.object({
  isActive: z.boolean("Record status is required."),
});

/** Route param check for `/api/patients/[id]` style routes. */
export const patientIdSchema = z.object({
  id: objectIdSchema,
});
