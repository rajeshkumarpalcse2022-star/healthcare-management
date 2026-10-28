/**
 * Patient Management configuration (P1-1).
 *
 * Gender reuses the Doctor module's three-value vocabulary so demographic
 * selects stay consistent platform-wide. Blood groups use underscore-safe
 * enum codes (`A_POS`) that map cleanly to clinical labels (`A+`) in DTOs.
 */
export const PATIENT_GENDERS = ["MALE", "FEMALE", "OTHER"] as const;

export type PatientGender = (typeof PATIENT_GENDERS)[number];

export const PATIENT_GENDER_LABELS: Record<PatientGender, string> = {
  MALE: "Male",
  FEMALE: "Female",
  OTHER: "Other",
};

export const PATIENT_BLOOD_GROUPS = [
  "A_POS",
  "A_NEG",
  "B_POS",
  "B_NEG",
  "AB_POS",
  "AB_NEG",
  "O_POS",
  "O_NEG",
] as const;

export type PatientBloodGroup = (typeof PATIENT_BLOOD_GROUPS)[number];

export const PATIENT_BLOOD_GROUP_LABELS: Record<PatientBloodGroup, string> = {
  A_POS: "A+",
  A_NEG: "A-",
  B_POS: "B+",
  B_NEG: "B-",
  AB_POS: "AB+",
  AB_NEG: "AB-",
  O_POS: "O+",
  O_NEG: "O-",
};

/** Staff-only clinical remarks cap. */
export const PATIENT_NOTES_MAX_LENGTH = 1000;

/**
 * Length of the server-generated temporary password handed back once on
 * staff-created patient accounts. Charset guarantees upper, lower and digit
 * characters; the value is bcrypt-hashed before storage and never logged.
 */
export const PATIENT_TEMP_PASSWORD_LENGTH = 16;
