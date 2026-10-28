import "server-only";

import { ROLES } from "@/config/roles";
import {
  canCancelAnyCollection,
  canViewCollectionManagement,
  COLLECTION_COLLECTOR_ACTIONABLE_STATUSES,
  type CollectionStatus,
} from "@/config/home-collection";
import { isLaboratoryInScope } from "@/lib/auth/laboratory-scope";
import type { SafeUser } from "@/types/auth";

/**
 * Server-side authorization rules for home collections (STEP 8).
 *
 * The client never decides visibility: every read and write re-derives the
 * caller from the session and applies these rules against the stored record.
 * Unauthorised detail access surfaces as 404 (not 403) so an attacker cannot
 * probe for the existence of another patient's collection reference - and a
 * collector changing the URL id cannot reach another collector's pickups.
 *
 * Laboratory scope (P1): LAB_MANAGER/STAFF accounts with assignments treat
 * collections from every other laboratory exactly like records that do not
 * exist (404) - folded in here so every detail/mutation route inherits it.
 */

interface CollectionOwnershipFields {
  patientId: unknown;
  assignedCollectorId?: unknown;
  /** Stored id (or populated reference) of the collection's laboratory. */
  laboratoryId?: unknown;
}

/** Extracts the raw id from a stored or populated Mongoose reference. */
function refId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && "_id" in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
}

/**
 * True when the collection's laboratory is inside the caller's scope.
 * Unscoped accounts and records without a laboratory id always pass.
 */
function collectionInScope(
  user: SafeUser,
  collection: CollectionOwnershipFields,
): boolean {
  const laboratoryId = refId(collection.laboratoryId);
  if (laboratoryId === null) return true;
  return isLaboratoryInScope(user, laboratoryId);
}

/** True when the caller may view this collection at all. */
export function canViewCollection(
  user: SafeUser,
  collection: CollectionOwnershipFields,
): boolean {
  if (!collectionInScope(user, collection)) return false;
  if (canViewCollectionManagement(user.role)) return true;
  if (user.role === ROLES.PATIENT) return isOwnCollection(user, collection);
  if (user.role === ROLES.COLLECTOR) {
    return isAssignedCollector(user, collection);
  }
  return false;
}

/** True when the caller may cancel this collection (policy enforced separately). */
export function canCancelCollection(
  user: SafeUser,
  collection: CollectionOwnershipFields,
): boolean {
  if (!collectionInScope(user, collection)) return false;
  if (canCancelAnyCollection(user.role)) return true;
  return isOwnCollection(user, collection);
}

/**
 * True when the caller (a COLLECTOR) may advance the pickup workflow for
 * this collection - i.e. it is assigned to them and still in an actionable
 * status. Operational status-write roles bypass this check in the route.
 */
export function canActOnAssignedCollection(
  user: SafeUser,
  collection: CollectionOwnershipFields & { status: string },
): boolean {
  if (user.role !== ROLES.COLLECTOR) return false;
  if (!isAssignedCollector(user, collection)) return false;
  return (COLLECTION_COLLECTOR_ACTIONABLE_STATUSES as readonly string[]).includes(
    collection.status,
  );
}

/** True when the collection belongs to the authenticated patient themself. */
function isOwnCollection(
  user: SafeUser,
  collection: CollectionOwnershipFields,
): boolean {
  if (user.role !== ROLES.PATIENT) return false;
  return sameId(collection.patientId, user.id);
}

/** True when the collection is assigned to the authenticated collector. */
function isAssignedCollector(
  user: SafeUser,
  collection: CollectionOwnershipFields,
): boolean {
  return sameId(collection.assignedCollectorId, user.id);
}

/** Compares a stored ref (ObjectId | populated doc | null) to a user id. */
function sameId(raw: unknown, userId: string): boolean {
  if (raw === null || raw === undefined) return false;
  const value =
    typeof raw === "object" && "_id" in raw
      ? (raw as { _id: unknown })._id
      : raw;
  return String(value) === userId;
}

/** Re-exported for route readability. */
export { canCancelAnyCollection, canViewCollectionManagement };

/** Narrows a stored status string to the central union (routes only). */
export function asCollectionStatus(value: string): CollectionStatus | null {
  switch (value) {
    case "PENDING":
    case "CONFIRMED":
    case "REJECTED":
    case "ASSIGNED":
    case "COLLECTOR_ACCEPTED":
    case "COLLECTOR_EN_ROUTE":
    case "ARRIVED":
    case "COLLECTED":
    case "FAILED":
    case "CANCELLED":
      return value;
    default:
      return null;
  }
}
