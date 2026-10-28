import "server-only";

import type { Types } from "mongoose";

import { ROLES } from "@/config/roles";
import type { DoctorRecord } from "@/models/Doctor";
import { Doctor } from "@/models/Doctor";
import type { SafeUser } from "@/types/auth";

/**
 * Server-side authorization helpers for the appointment module.
 *
 * The client never decides visibility: every read and write re-derives the
 * caller from the session and applies these rules against the stored record.
 * Unauthorised detail access surfaces as 404 (not 403) so an attacker cannot
 * probe for the existence of another patient's appointment reference.
 *
 * Doctor identity: a DOCTOR-role login reaches its appointments only through
 * its linked, active Doctor profile (`Doctor.userId`). A login without a
 * profile (or with a deactivated one) gets a clear 403 on doctor surfaces -
 * the pending-approval workflow is never bypassed.
 */

/** Doctor profile as returned by a lean query. */
export type DoctorProfileLean = DoctorRecord & { _id: Types.ObjectId };

/** Extracts the raw id from a stored or populated Mongoose reference. */
export function refId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && "_id" in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
}

/**
 * Resolves the caller's linked, active doctor profile.
 * Returns `null` when the account has no profile or it is deactivated.
 */
export async function getActiveDoctorProfileForUser(
  userId: string,
): Promise<DoctorProfileLean | null> {
  const profile = await Doctor.findOne({ userId, isActive: true })
    .lean<DoctorProfileLean | null>();
  return profile;
}

/** Resolves a doctor profile by id (any status) for schedule lookups. */
export async function getDoctorProfileById(
  doctorId: string,
): Promise<DoctorProfileLean | null> {
  const profile = await Doctor.findById(doctorId)
    .lean<DoctorProfileLean | null>();
  return profile;
}

interface AppointmentVisibilityFields {
  patientId: unknown;
  doctorId: unknown;
}

/**
 * True when the caller may view this appointment at all.
 * Administrative monitoring roles see everything; a patient only their own
 * appointments; a doctor only appointments of their linked profile.
 */
export function appointmentVisibleTo(
  user: SafeUser,
  appointment: AppointmentVisibilityFields,
  doctorProfileId: string | null,
): boolean {
  if (user.role === ROLES.SUPER_ADMIN || user.role === ROLES.ADMIN) return true;
  if (user.role === ROLES.PATIENT) {
    return refId(appointment.patientId) === user.id;
  }
  if (user.role === ROLES.DOCTOR) {
    return (
      doctorProfileId !== null &&
      refId(appointment.doctorId) === doctorProfileId
    );
  }
  return false;
}

/** True when the caller is the appointment's owning patient themself. */
export function isAppointmentPatient(
  user: SafeUser,
  appointment: AppointmentVisibilityFields,
): boolean {
  if (user.role !== ROLES.PATIENT) return false;
  return refId(appointment.patientId) === user.id;
}

/**
 * True when the caller's doctor profile owns the appointment.
 * Pass the profile id resolved by `getActiveDoctorProfileForUser`.
 */
export function isAppointmentDoctor(
  user: SafeUser,
  appointment: AppointmentVisibilityFields,
  doctorProfileId: string | null,
): boolean {
  if (user.role !== ROLES.DOCTOR) return false;
  return (
    doctorProfileId !== null &&
    refId(appointment.doctorId) === doctorProfileId
  );
}
