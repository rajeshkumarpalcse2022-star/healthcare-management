import { ROLES } from "@/config/roles";
import type { SafeUser } from "@/types/auth";

/**
 * Pure per-laboratory scoping helper - the single place that decides which
 * laboratories an account may see.
 *
 * Design contract (P1):
 * - only LAB_MANAGER and STAFF are ever restricted; every other role
 *   (SUPER_ADMIN, ADMIN, DOCTOR, PATIENT, COLLECTOR) is platform-wide;
 * - for a scoped role, an ABSENT `laboratoryIds` field means a legacy
 *   platform-wide account (no automatic backfill - assignment happens only
 *   through the explicit admin API);
 * - `[]` means explicitly scoped to no laboratory (what new LM/STAFF
 *   provisioning writes);
 * - the session token is untouched: scope is resolved from the user record
 *   on every request via `SafeUser`.
 *
 * Pure and dependency-light on purpose so offline contract tests can import
 * it directly (no `server-only`, no DB).
 */

/** The subset of a user that scoping decisions depend on. */
export type ScopeSubject = Pick<SafeUser, "role"> &
  Partial<Pick<SafeUser, "laboratoryIds">>;

/**
 * `null`  -> unrestricted (platform-wide)
 * `ids[]` -> restricted to exactly these laboratories (may be empty)
 */
export type LaboratoryScope = string[] | null;

/** Roles that can ever be restricted to laboratories (D1 decision). */
export const SCOPED_ROLES: readonly string[] = [
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
];

/**
 * Resolves the effective laboratory scope for a user.
 *
 * Returns `null` for unrestricted access and the (possibly empty) list of
 * laboratory ids for restricted accounts.
 */
export function resolveLaboratoryScope(user: ScopeSubject): LaboratoryScope {
  if (!SCOPED_ROLES.includes(user.role)) return null;
  if (!Array.isArray(user.laboratoryIds)) return null;
  return user.laboratoryIds;
}

/** True when `laboratoryId` is visible to this user. */
export function isLaboratoryInScope(
  user: ScopeSubject,
  laboratoryId: string,
): boolean {
  const scope = resolveLaboratoryScope(user);
  if (scope === null) return true;
  return scope.includes(laboratoryId);
}

/**
 * Builds a MongoDB filter fragment that restricts `field` (default
 * `laboratoryId`) to the user's scope. Returns `{}` for unrestricted users
 * so callers can always spread: `{ ...scopeFilter(user), ...query }`.
 */
export function scopeFilter(
  user: ScopeSubject,
  field = "laboratoryId",
): Record<string, unknown> {
  const scope = resolveLaboratoryScope(user);
  if (scope === null) return {};
  return { [field]: { $in: [...scope] } };
}
