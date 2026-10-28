import type {
  PatientAddress,
  PatientEmergencyContact,
} from "@/models/PatientProfile";

/**
 * Patient DTO mappers (P1-1).
 *
 * Two shapes:
 * - `PatientDto` (staff view): identity + demographics + staff-only notes.
 * - `PatientSelfDto` (patient view): identity + demographics, with the
 *   `notes` key ABSENT entirely - the mapper never receives or forwards
 *   clinical remarks on the self path.
 *
 * A missing profile document synthesizes a blank, inactive-free profile
 * (`hasProfile: false`) so legacy PATIENT accounts keep working without any
 * backfill write. Like the rest of the platform's serialisers this module is
 * client-safe: pure functions over plain shapes, no mongoose imports.
 */

export interface PatientProfileDto {
  dateOfBirth: string | null;
  gender: string | null;
  bloodGroup: string | null;
  address: PatientAddress | null;
  emergencyContact: PatientEmergencyContact | null;
  /** Staff-only clinical remarks. Present on staff DTOs only. */
  notes?: string | null;
  /** Record-level switch (deactivate hides from pickers, blocks new bookings). */
  isActive: boolean;
  /** False when synthesized for a legacy account with no profile row yet. */
  hasProfile: boolean;
  updatedAt: string | null;
}

export interface PatientDto {
  /** PATIENT-role User id - the stable key used by bookings/collections. */
  id: string;
  name: string;
  email: string;
  phone: string | null;
  /** Login-blocking switch on the User account (distinct from profile.isActive). */
  accountActive: boolean;
  createdAt: string;
  profile: PatientProfileDto;
}

export type PatientSelfDto = Omit<PatientDto, "profile"> & {
  profile: Omit<PatientProfileDto, "notes">;
};

/** Lean shape accepted from a populated/fetched profile row (or null). */
export interface PatientProfileShape {
  dateOfBirth?: Date | string | null;
  gender?: string | null;
  bloodGroup?: string | null;
  address?: PatientAddress | null;
  emergencyContact?: PatientEmergencyContact | null;
  notes?: string | null;
  isActive?: boolean;
  updatedAt?: Date | string | null;
}

/** Lean shape accepted from the User document backing the patient. */
export interface PatientUserShape {
  _id: unknown;
  name: string;
  email: string;
  phone?: string | null;
  isActive?: boolean;
  createdAt: Date | string;
}

function toIsoDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** `YYYY-MM-DD` for `<input type="date">` binding (UTC calendar date). */
function toDateInputValue(
  value: Date | string | null | undefined,
): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function toPatientProfileDto(
  profile: PatientProfileShape | null | undefined,
  includeNotes: boolean,
): PatientProfileDto {
  const dto: PatientProfileDto = {
    dateOfBirth: toDateInputValue(profile?.dateOfBirth),
    gender: profile?.gender ?? null,
    bloodGroup: profile?.bloodGroup ?? null,
    address: profile?.address ?? null,
    emergencyContact: profile?.emergencyContact ?? null,
    isActive: profile?.isActive ?? true,
    hasProfile: Boolean(profile),
    updatedAt: toIsoDate(profile?.updatedAt),
  };
  if (includeNotes) {
    dto.notes = profile?.notes ?? null;
  }
  return dto;
}

export function toPatientDto(
  user: PatientUserShape,
  profile: PatientProfileShape | null | undefined,
): PatientDto {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    phone: user.phone ?? null,
    accountActive: user.isActive ?? true,
    createdAt: toIsoDate(user.createdAt) ?? "",
    profile: toPatientProfileDto(profile, true),
  };
}

export function toPatientSelfDto(
  user: PatientUserShape,
  profile: PatientProfileShape | null | undefined,
): PatientSelfDto {
  const base = toPatientDto(user, profile);
  // Rebuild the profile WITHOUT the notes key - not merely undefined, so the
  // clinical remarks can never ride along on a self-view payload.
  return { ...base, profile: toPatientProfileDto(profile, false) };
}
