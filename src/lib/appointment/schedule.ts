import "server-only";

import {
  addDaysToDateString,
  compareDateStrings,
  generateSlotStarts,
  overlapsAnyWindow,
  todayInTimeZone,
  zonedWallClockToDate,
} from "@/lib/utils/booking-time";
import type { DoctorScheduleConfig } from "@/types/appointment";
import { effectiveScheduleForDate } from "@/lib/appointment/schedule-conflicts";

/**
 * Shared schedule verification for booking and rescheduling.
 *
 * Every rule the availability endpoint enforces for display is re-checked
 * here against the stored schedule - the client's slot picker is never
 * trusted. Returns the timezone / slot duration needed to persist the
 * appointment when the slot is valid, or a user-facing failure otherwise.
 */
export type SlotCheckResult =
  | {
      ok: true;
      timezone: string;
      slotDurationMinutes: number;
      slotCapacity: number;
    }
  | { ok: false; message: string; field: "appointmentDate" | "timeSlot" };

export function verifyAppointmentSlot(
  scheduleConfig: DoctorScheduleConfig | undefined | null,
  date: string,
  timeSlot: string,
): SlotCheckResult {
  if (!scheduleConfig) {
    return {
      ok: false,
      message: "This doctor has not configured appointment availability yet.",
      field: "appointmentDate",
    };
  }

  const today = todayInTimeZone(scheduleConfig.timezone);
  const vsToday = compareDateStrings(date, today);
  if (vsToday === null || vsToday < 0) {
    return {
      ok: false,
      message: "Appointments cannot be made for a past date.",
      field: "appointmentDate",
    };
  }

  const lastDate = addDaysToDateString(today, scheduleConfig.maxAdvanceDays);
  if (
    lastDate &&
    compareDateStrings(date, lastDate) !== null &&
    compareDateStrings(date, lastDate)! > 0
  ) {
    return {
      ok: false,
      message: `Appointments can only be made up to ${scheduleConfig.maxAdvanceDays} days ahead.`,
      field: "appointmentDate",
    };
  }

  const override = scheduleConfig.dateOverrides?.find(
    (entry) => entry.date === date,
  );
  const effective = effectiveScheduleForDate(scheduleConfig, date);
  if (!effective) {
    return {
      ok: false,
      message:
        override?.isClosed || scheduleConfig.unavailableDates?.includes(date)
          ? "The doctor is unavailable on the selected date."
          : "The doctor does not consult on the selected day.",
      field: "appointmentDate",
    };
  }

  const validStarts = generateSlotStarts(
    effective.openingTime,
    effective.closingTime,
    effective.slotDurationMinutes,
  );
  if (!validStarts.includes(timeSlot)) {
    return {
      ok: false,
      message: "The selected time slot is not offered.",
      field: "timeSlot",
    };
  }

  if (
    overlapsAnyWindow(
      timeSlot,
      effective.slotDurationMinutes,
      effective.breaks,
    )
  ) {
    return {
      ok: false,
      message: "The selected time slot falls inside the doctor's break.",
      field: "timeSlot",
    };
  }

  const startAt = zonedWallClockToDate(date, timeSlot, scheduleConfig.timezone);
  if (!startAt || startAt.getTime() <= Date.now()) {
    return {
      ok: false,
      message: "The selected time slot has already passed.",
      field: "timeSlot",
    };
  }

  return {
    ok: true,
    timezone: scheduleConfig.timezone,
    slotDurationMinutes: effective.slotDurationMinutes,
    slotCapacity: effective.slotCapacity,
  };
}
