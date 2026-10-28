import {
  addDaysToDateString,
  compareDateStrings,
  parseTimeString,
  weekdayOfDate,
} from "@/lib/utils/booking-time";
import type {
  DoctorEffectiveSchedule,
  DoctorScheduleConfig,
} from "@/types/appointment";

/**
 * Clinic-aware schedule conflict detection.
 *
 * A doctor must never be scheduled in two clinics at the same time. The same
 * pure function runs in the schedule editor for instant red feedback and on
 * the server where it is actually enforced.
 */

export interface ClinicScheduleInput {
  clinicId: string;
  clinicName: string;
  schedule: DoctorScheduleConfig | null;
}

export interface ScheduleConflict {
  clinicId: string;
  clinicName: string;
  date: string;
  start: string;
  end: string;
  message: string;
}

export interface WorkingWindow {
  start: string;
  end: string;
}

function minutesOf(time: string): number | null {
  const parsed = parseTimeString(time);
  if (!parsed) return null;
  return parsed.hour * 60 + parsed.minute;
}

function timeOf(minutes: number): string {
  const safe = Math.max(0, Math.min(24 * 60, minutes));
  const hour = Math.floor(safe / 60);
  const minute = safe % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function windowsWithoutBreaks(
  openingTime: string,
  closingTime: string,
  breaks: DoctorScheduleConfig["breaks"],
): WorkingWindow[] {
  const opening = minutesOf(openingTime);
  const closing = minutesOf(closingTime);
  if (opening === null || closing === null || closing <= opening) return [];

  const cuts = breaks
    .map((entry) => ({
      start: minutesOf(entry.start),
      end: minutesOf(entry.end),
    }))
    .filter(
      (entry): entry is { start: number; end: number } =>
        entry.start !== null && entry.end !== null && entry.end > entry.start,
    )
    .sort((a, b) => a.start - b.start);

  const windows: WorkingWindow[] = [];
  let cursor = opening;

  for (const cut of cuts) {
    if (cut.end <= cursor) continue;
    if (cut.start >= closing) break;
    if (cut.start > cursor) {
      windows.push({
        start: timeOf(cursor),
        end: timeOf(Math.min(cut.start, closing)),
      });
    }
    cursor = Math.max(cursor, cut.end);
    if (cursor >= closing) break;
  }

  if (cursor < closing) {
    windows.push({ start: timeOf(cursor), end: timeOf(closing) });
  }
  return windows;
}

/**
 * Resolves the hours in force for one clinic on one date. Date overrides take
 * precedence over the weekly template; leave dates close the whole day.
 */
export function effectiveScheduleForDate(
  config: DoctorScheduleConfig,
  date: string,
): DoctorEffectiveSchedule | null {
  const override = config.dateOverrides?.find((entry) => entry.date === date);
  if (override) {
    if (override.isClosed) return null;
    return {
      openingTime: override.openingTime,
      closingTime: override.closingTime,
      slotDurationMinutes: override.slotDurationMinutes,
      slotCapacity: override.slotCapacity,
      breaks: [...override.breaks],
    };
  }

  if (config.unavailableDates?.includes(date)) return null;

  const weekday = weekdayOfDate(date);
  if (weekday === null || !config.operatingDays.includes(weekday)) return null;

  return {
    openingTime: config.openingTime,
    closingTime: config.closingTime,
    slotDurationMinutes: config.slotDurationMinutes,
    slotCapacity: config.slotCapacity ?? 1,
    breaks: [...(config.breaks ?? [])],
  };
}

/** Working windows for a date after removing breaks. Closed days return []. */
export function workingWindowsForDate(
  config: DoctorScheduleConfig,
  date: string,
): WorkingWindow[] {
  const effective = effectiveScheduleForDate(config, date);
  if (!effective) return [];
  return windowsWithoutBreaks(
    effective.openingTime,
    effective.closingTime,
    effective.breaks,
  );
}

function overlap(
  a: WorkingWindow,
  b: WorkingWindow,
): { start: string; end: string } | null {
  const start = Math.max(minutesOf(a.start)!, minutesOf(b.start)!);
  const end = Math.min(minutesOf(a.end)!, minutesOf(b.end)!);
  if (start >= end) return null;
  return { start: timeOf(start), end: timeOf(end) };
}

/**
 * Finds the first date/time where a candidate schedule overlaps another
 * clinic's schedule.
 *
 * Weekly patterns repeat, so the next 14 days cover every weekday. Any date
 * overrides on either side are added explicitly, which catches future
 * one-off changes as well.
 */
export function findScheduleConflict(
  candidate: DoctorScheduleConfig,
  candidateClinicId: string,
  otherClinics: ClinicScheduleInput[],
  fromDate: string,
): ScheduleConflict | null {
  const dates = new Set<string>();
  for (let offset = 0; offset < 14; offset += 1) {
    const date = addDaysToDateString(fromDate, offset);
    if (date) dates.add(date);
  }

  for (const override of candidate.dateOverrides ?? []) {
    if (
      compareDateStrings(override.date, fromDate) !== null &&
      compareDateStrings(override.date, fromDate)! >= 0
    ) {
      dates.add(override.date);
    }
  }

  for (const other of otherClinics) {
    for (const override of other.schedule?.dateOverrides ?? []) {
      if (
        compareDateStrings(override.date, fromDate) !== null &&
        compareDateStrings(override.date, fromDate)! >= 0
      ) {
        dates.add(override.date);
      }
    }
  }

  const ordered = [...dates].sort(
    (a, b) => compareDateStrings(a, b) ?? 0,
  );

  for (const date of ordered) {
    const candidateWindows = workingWindowsForDate(candidate, date);
    if (candidateWindows.length === 0) continue;

    for (const other of otherClinics) {
      if (other.clinicId === candidateClinicId || !other.schedule) continue;

      const otherWindows = workingWindowsForDate(other.schedule, date);
      for (const candidateWindow of candidateWindows) {
        for (const otherWindow of otherWindows) {
          const hit = overlap(candidateWindow, otherWindow);
          if (hit) {
            return {
              clinicId: other.clinicId,
              clinicName: other.clinicName,
              date,
              start: hit.start,
              end: hit.end,
              message: `This schedule conflicts with ${other.clinicName} on ${date} (${hit.start}-${hit.end}). The same doctor cannot be in two clinics at once.`,
            };
          }
        }
      }
    }
  }

  return null;
}
