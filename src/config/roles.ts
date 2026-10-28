/**
 * Centralised role definitions.
 *
 * Every role string in the platform resolves through this module, so adding a
 * role later is a single edit here - no scattered literals to chase down.
 * Role *identity* only: business behaviour per role arrives in later steps.
 */
export const ROLES = {
  SUPER_ADMIN: "SUPER_ADMIN",
  ADMIN: "ADMIN",
  DOCTOR: "DOCTOR",
  LAB_MANAGER: "LAB_MANAGER",
  STAFF: "STAFF",
  PATIENT: "PATIENT",
  /** Home sample collection field worker (STEP 8). */
  COLLECTOR: "COLLECTOR",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

/** Runtime list of every registered role. */
export const ROLE_VALUES: Role[] = Object.values(ROLES);

/**
 * Roles an administrator may provision through `POST /api/users`.
 *
 * - SUPER_ADMIN is excluded: platform-owner accounts are seed-only, never
 *   creatable through an application API (no privilege-escalation path).
 * - PATIENT is excluded: patients self-register through the public
 *   registration endpoint.
 */
export const PROVISIONABLE_ROLES = [
  ROLES.ADMIN,
  ROLES.DOCTOR,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
  ROLES.COLLECTOR,
] as const;

export type ProvisionableRole = (typeof PROVISIONABLE_ROLES)[number];

/** Human-readable labels for menus, badges and headers. */
export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  DOCTOR: "Doctor",
  LAB_MANAGER: "Lab Manager",
  STAFF: "Staff",
  PATIENT: "Patient",
  COLLECTOR: "Collector",
};

/** Type guard for values arriving from cookies, query params or the DB. */
export function isRole(value: unknown): value is Role {
  return (
    typeof value === "string" &&
    (ROLE_VALUES as string[]).includes(value)
  );
}

/** Display label for a role, falling back to the raw value when unknown. */
export function roleLabel(role: string): string {
  return isRole(role) ? ROLE_LABELS[role] : role;
}
