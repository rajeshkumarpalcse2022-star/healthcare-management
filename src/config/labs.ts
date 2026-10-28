import { ROLES, type Role } from "@/config/roles";

/**
 * Lab / LIMS module configuration.
 *
 * Kept dependency-free (no `server-only`, no mongoose) so client components
 * can import the same lists the server validates against. All categorical
 * strings live here - components never scatter raw literals.
 */

/**
 * Test categories - the classification shown on orders, reports and the test
 * directory filter. `Other` catches anything outside the standard taxonomy.
 */
export const TEST_CATEGORIES = [
  "Biochemistry",
  "Clinical Pathology",
  "Hematology",
  "Microbiology",
  "Serology",
  "Immunology",
  "Hormone Assay",
  "Tumor Marker",
  "Molecular Diagnostics",
  "Histopathology",
  "Cytopathology",
  "Toxicology",
  "Other",
] as const;

export type TestCategory = (typeof TEST_CATEGORIES)[number];

/** Material collected for analysis. */
export const SPECIMEN_TYPES = [
  "Blood",
  "Serum",
  "Plasma",
  "Whole Blood",
  "Urine",
  "Stool",
  "Sputum",
  "Swab",
  "Tissue",
  "CSF",
  "Saliva",
  "Seminal Fluid",
  "Bone Marrow",
  "Other",
] as const;

export type SpecimenType = (typeof SPECIMEN_TYPES)[number];

/**
 * Sample collection methods a lab test may offer.
 *
 * `LAB_VISIT` - the patient visits the laboratory to provide the sample.
 * `HOME_COLLECTION` - a collector visits the patient's home.
 *
 * A test must offer at least one method; both may be offered at once, in
 * which case the patient picks their preferred method during booking.
 */
export const SAMPLE_COLLECTION_METHODS = [
  "LAB_VISIT",
  "HOME_COLLECTION",
] as const;

export type SampleCollectionMethod = (typeof SAMPLE_COLLECTION_METHODS)[number];

export const SAMPLE_COLLECTION_METHOD_LABELS: Record<
  SampleCollectionMethod,
  string
> = {
  LAB_VISIT: "Visit the laboratory",
  HOME_COLLECTION: "Home collection",
};

export const SAMPLE_COLLECTION_METHOD_DESCRIPTIONS: Record<
  SampleCollectionMethod,
  string
> = {
  LAB_VISIT: "Patient visits the laboratory to provide the sample.",
  HOME_COLLECTION: "A collector visits the patient's home to collect the sample.",
};

/** Human-readable summary used by directory tables and detail views. */
export function sampleCollectionSummary(
  labVisitEnabled: boolean,
  homeCollectionEnabled: boolean,
): string {
  if (labVisitEnabled && homeCollectionEnabled) return "Lab visit or home";
  if (labVisitEnabled) return "Lab visit only";
  if (homeCollectionEnabled) return "Home collection only";
  return "Unavailable";
}

/**
 * Backward-compatible defaults for tests stored before per-test collection
 * options existed. A missing flag always reads as "both methods enabled" so
 * pre-existing tests never become unbookable.
 */
export function allowsLabVisit(
  test: { labVisitEnabled?: boolean | null } | null | undefined,
): boolean {
  return test?.labVisitEnabled !== false;
}

export function allowsHomeCollection(
  test: { homeCollectionEnabled?: boolean | null } | null | undefined,
): boolean {
  return test?.homeCollectionEnabled !== false;
}

/**
 * Parameter data types - drive result validation and display in later steps.
 * NUMBER parameters validate against reference/critical ranges; ENUM carries
 * allowed values in its reference text.
 */
export const PARAMETER_DATA_TYPES = [
  "NUMBER",
  "TEXT",
  "BOOLEAN",
  "POSITIVE_NEGATIVE",
  "ENUM",
] as const;

export type ParameterDataType = (typeof PARAMETER_DATA_TYPES)[number];

export const PARAMETER_DATA_TYPE_LABELS: Record<ParameterDataType, string> = {
  NUMBER: "Number",
  TEXT: "Text",
  BOOLEAN: "Yes / No",
  POSITIVE_NEGATIVE: "Positive / Negative",
  ENUM: "Enum",
};

/**
 * Common lab department names offered as UI suggestions only. Actual
 * department records always come from the database - nothing here is seeded.
 */
export const DEPARTMENT_SUGGESTIONS = [
  "Hematology",
  "Biochemistry",
  "Microbiology",
  "Pathology",
  "Immunology",
  "Clinical Chemistry",
] as const;

/** Status filter values accepted by the list endpoints. */
export const STATUS_FILTERS = ["all", "active", "inactive"] as const;

export type StatusFilter = (typeof STATUS_FILTERS)[number];

/** Server-side pagination defaults for the module. */
export const LIST_DEFAULT_LIMIT = 10;
export const LIST_MAX_LIMIT = 50;

/**
 * Roles allowed to administer laboratories, departments, tests and
 * parameters. LAB_MANAGER exists specifically for this module.
 */
export const LAB_WRITE_ROLES: Role[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
];

/** Roles allowed to browse the lab directory (read-only for STAFF/DOCTOR). */
export const LAB_READ_ROLES: Role[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
  ROLES.DOCTOR,
];

/** True when the role may create / edit / toggle lab configuration. */
export function canManageLabModule(role: Role): boolean {
  return LAB_WRITE_ROLES.includes(role);
}

/** True when the role may view the module at all. */
export function canViewLabModule(role: Role): boolean {
  return LAB_READ_ROLES.includes(role);
}
