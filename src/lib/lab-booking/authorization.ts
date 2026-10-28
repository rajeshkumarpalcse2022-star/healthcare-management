import "server-only";

import { ROLES } from "@/config/roles";
import {
  canCancelAnyBooking,
  canViewBookingManagement,
} from "@/config/lab-bookings";
import { isLaboratoryInScope } from "@/lib/auth/laboratory-scope";
import type { SafeUser } from "@/types/auth";

/**
 * Server-side authorization rules for lab bookings.
 *
 * The client never decides visibility: every read and write re-derives the
 * caller from the session and applies these rules against the stored record.
 * Unauthorised detail access surfaces as 404 (not 403) so an attacker cannot
 * probe for the existence of another patient's booking reference.
 *
 * Laboratory scope (P1): when the caller is a LAB_MANAGER/STAFF account
 * with assignments, a booking belonging to any other laboratory is treated
 * exactly like a booking that does not exist (404) - this is checked here so
 * every booking detail/mutation route inherits it.
 */

interface BookingOwnershipFields {
  patientId: unknown;
  /** Stored id (or populated reference) of the booking's laboratory. */
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
 * True when the booking's laboratory is inside the caller's scope.
 * Unscoped accounts and bookings without a laboratory id (legacy safety)
 * always pass; scoped accounts only see bookings in their laboratories.
 */
function bookingInScope(user: SafeUser, booking: BookingOwnershipFields): boolean {
  const laboratoryId = refId(booking.laboratoryId);
  if (laboratoryId === null) return true;
  return isLaboratoryInScope(user, laboratoryId);
}

/** True when the caller may view this booking at all. */
export function canViewBooking(
  user: SafeUser,
  booking: BookingOwnershipFields,
): boolean {
  if (!bookingInScope(user, booking)) return false;
  if (canViewBookingManagement(user.role)) return true;
  return isOwnBooking(user, booking);
}

/** True when the caller may cancel this booking (policy enforced separately). */
export function canCancelBooking(
  user: SafeUser,
  booking: BookingOwnershipFields,
): boolean {
  if (!bookingInScope(user, booking)) return false;
  if (canCancelAnyBooking(user.role)) return true;
  return isOwnBooking(user, booking);
}

/** True when the booking belongs to the authenticated patient themself. */
function isOwnBooking(user: SafeUser, booking: BookingOwnershipFields): boolean {
  if (user.role !== ROLES.PATIENT) return false;
  const patientId = booking.patientId;
  if (patientId === null || patientId === undefined) return false;
  const raw =
    typeof patientId === "object" && "_id" in patientId
      ? (patientId as { _id: unknown })._id
      : patientId;
  return String(raw) === user.id;
}

/** Re-exported for route readability. */
export { canCancelAnyBooking, canViewBookingManagement };
