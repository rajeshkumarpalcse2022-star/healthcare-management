import type { DoctorScheduleConfig } from "@/types/appointment";

/**
 * Pure helpers for reading a doctor's clinic affiliations and per-clinic
 * schedules. Legacy records only have `clinicId` + `scheduleConfig`; newer
 * records also carry `clinicIds` + `clinicSchedules`. Both shapes are
 * supported here so every caller behaves consistently during the migration.
 */

interface ClinicScheduleLike {
  clinicId: unknown;
  scheduleConfig?: DoctorScheduleConfig | null;
}

export interface DoctorClinicScheduleShape {
  clinicId?: unknown;
  clinicIds?: unknown[] | null;
  scheduleConfig?: DoctorScheduleConfig | null;
  clinicSchedules?: ClinicScheduleLike[] | null;
}

/** Extracts a raw id from a stored object id or a populated document. */
export function refId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && "_id" in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
}

/** All assigned clinic ids, primary first, with duplicates removed. */
export function doctorClinicIds(doctor: DoctorClinicScheduleShape): string[] {
  const ids: string[] = [];
  const push = (value: unknown) => {
    const id = refId(value);
    if (id && !ids.includes(id)) ids.push(id);
  };

  push(doctor.clinicId);
  if (Array.isArray(doctor.clinicIds)) {
    doctor.clinicIds.forEach(push);
  }
  return ids;
}

/**
 * Returns the saved schedule for one clinic, falling back to the legacy
 * primary schedule. `null` means this clinic has not been configured.
 */
export function getDoctorClinicSchedule(
  doctor: DoctorClinicScheduleShape,
  clinicId: string,
): DoctorScheduleConfig | null {
  if (Array.isArray(doctor.clinicSchedules)) {
    const assignment = doctor.clinicSchedules.find(
      (entry) => refId(entry.clinicId) === clinicId,
    );
    if (assignment?.scheduleConfig) return assignment.scheduleConfig;
  }

  if (
    refId(doctor.clinicId) === clinicId &&
    doctor.scheduleConfig
  ) {
    return doctor.scheduleConfig;
  }

  return null;
}

/** True when at least one assigned clinic has a schedule. */
export function hasConfiguredClinicSchedule(
  doctor: DoctorClinicScheduleShape,
): boolean {
  return doctorClinicIds(doctor).some(
    (clinicId) => getDoctorClinicSchedule(doctor, clinicId) !== null,
  );
}

/**
 * Stored schedules in a uniform list, including the legacy primary schedule.
 * Used when assignments change so a doctor never loses saved hours.
 */
export function storedClinicSchedules(
  doctor: DoctorClinicScheduleShape,
): { clinicId: string; scheduleConfig: DoctorScheduleConfig }[] {
  const entries: {
    clinicId: string;
    scheduleConfig: DoctorScheduleConfig;
  }[] = [];
  const seen = new Set<string>();

  if (Array.isArray(doctor.clinicSchedules)) {
    for (const entry of doctor.clinicSchedules) {
      const clinicId = refId(entry.clinicId);
      if (!clinicId || !entry.scheduleConfig || seen.has(clinicId)) continue;
      seen.add(clinicId);
      entries.push({ clinicId, scheduleConfig: entry.scheduleConfig });
    }
  }

  const primaryId = refId(doctor.clinicId);
  if (primaryId && doctor.scheduleConfig && !seen.has(primaryId)) {
    entries.push({ clinicId: primaryId, scheduleConfig: doctor.scheduleConfig });
  }
  return entries;
}
