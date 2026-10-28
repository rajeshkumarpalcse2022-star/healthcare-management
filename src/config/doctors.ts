import { ROLES, type Role } from "@/config/roles";

/**
 * Doctor / Clinic module configuration.
 *
 * Kept dependency-free (no `server-only`, no mongoose) so client components
 * can import the same lists the server validates against.
 */

/** Specialisations offered by the doctor directory. */
export const SPECIALIZATIONS = [
  "General Medicine",
  "Cardiology",
  "Dermatology",
  "Endocrinology",
  "Gastroenterology",
  "Gynecology",
  "Neurology",
  "Oncology",
  "Ophthalmology",
  "Orthopedics",
  "Pediatrics",
  "Psychiatry",
  "Pulmonology",
  "Radiology",
  "Urology",
  "Other",
] as const;

export type Specialization = (typeof SPECIALIZATIONS)[number];

export const SPECIALIZATION_VALUES: string[] = [...SPECIALIZATIONS];

/** Genders accepted on the doctor profile form. */
export const DOCTOR_GENDERS = ["MALE", "FEMALE", "OTHER"] as const;

export type DoctorGender = (typeof DOCTOR_GENDERS)[number];

export const DOCTOR_GENDER_LABELS: Record<DoctorGender, string> = {
  MALE: "Male",
  FEMALE: "Female",
  OTHER: "Other",
};

/** Status filter values accepted by the list endpoints. */
export const STATUS_FILTERS = ["all", "active", "inactive"] as const;

export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** Server-side pagination defaults for the module. */
export const LIST_DEFAULT_LIMIT = 10;
export const LIST_MAX_LIMIT = 50;

/** Roles allowed to administer clinics and doctors. */
export const MODULE_ADMIN_ROLES: Role[] = [ROLES.SUPER_ADMIN, ROLES.ADMIN];

/** True when the role may create / edit / toggle clinics and doctors. */
export function canManageModule(role: Role): boolean {
  return MODULE_ADMIN_ROLES.includes(role);
}

/** True when the role is a doctor who may view their own profile. */
export function isDoctorRole(role: Role): boolean {
  return role === ROLES.DOCTOR;
}

/** True when the role may view the module at all. */
export function canViewModule(role: Role): boolean {
  return canManageModule(role) || isDoctorRole(role);
}
