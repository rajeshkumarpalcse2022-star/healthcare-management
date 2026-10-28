/**
 * Pure calendar and time-slot helpers for laboratory booking.
 *
 * Dependency-free (no mongoose, no `server-only`, no Next.js) so the same
 * functions run inside API routes and offline contract tests. All laboratory
 * wall-clock reasoning happens in the laboratory's configured IANA timezone;
 * nothing here assumes the server's own zone.
 */

/** `YYYY-MM-DD` calendar-date shape. */
export const DATE_STRING_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `HH:mm` 24-hour time shape. */
export const TIME_STRING_PATTERN = /^(\d{2}):(\d{2})$/;

export interface DateParts {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
}

/** Parses `YYYY-MM-DD` into numeric parts; `null` when invalid. */
export function parseDateString(value: string): DateParts | null {
  const match = DATE_STRING_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  // Reject impossible calendar dates such as 2026-02-30.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

/** True when `value` is a valid `YYYY-MM-DD` calendar date. */
export function isValidDateString(value: string): boolean {
  return parseDateString(value) !== null;
}

/** Parses `HH:mm` into `{ hour, minute }`; `null` when invalid. */
export function parseTimeString(
  value: string,
): { hour: number; minute: number } | null {
  const match = TIME_STRING_PATTERN.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** True when `value` is a valid `HH:mm` time. */
export function isValidTimeString(value: string): boolean {
  return parseTimeString(value) !== null;
}

/** Weekday index (0 = Sunday … 6 = Saturday) of a calendar date string. */
export function weekdayOfDate(dateString: string): number | null {
  const parts = parseDateString(dateString);
  if (!parts) return null;
  return new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  ).getUTCDay();
}

/** Adds (or subtracts) days to a calendar date string. */
export function addDaysToDateString(value: string, days: number): string | null {
  const parts = parseDateString(value);
  if (!parts) return null;
  const shifted = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day + days),
  );
  return shifted.toISOString().slice(0, 10);
}

/** Compares two `YYYY-MM-DD` strings (`-1`, `0`, `1`); invalid → `null`. */
export function compareDateStrings(a: string, b: string): number | null {
  const pa = parseDateString(a);
  const pb = parseDateString(b);
  if (!pa || !pb) return null;
  const va = Date.UTC(pa.year, pa.month - 1, pa.day);
  const vb = Date.UTC(pb.year, pb.month - 1, pb.day);
  return va < vb ? -1 : va > vb ? 1 : 0;
}

/* ------------------------------------------------------------------ *
 * Timezone handling
 * ------------------------------------------------------------------ */

interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockPartsOf(
  timestampMs: number,
  timeZone: string,
): WallClockParts | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const parts = formatter.formatToParts(new Date(timestampMs));
    const lookup: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== "literal") lookup[part.type] = part.value;
    }
    return {
      year: Number(lookup.year),
      month: Number(lookup.month),
      day: Number(lookup.day),
      hour: Number(lookup.hour) % 24,
      minute: Number(lookup.minute),
      second: Number(lookup.second),
    };
  } catch {
    return null;
  }
}

/** True when `timeZone` is a valid IANA zone the runtime understands. */
export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== "string" || timeZone.length === 0) return false;
  return wallClockPartsOf(Date.now(), timeZone) !== null;
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
export function timeZoneOffsetMs(timestampMs: number, timeZone: string): number {
  const wall = wallClockPartsOf(timestampMs, timeZone);
  if (!wall) return 0;
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
  );
  return asUtc - timestampMs;
}

/**
 * Converts a laboratory wall-clock date + time in `timeZone` to the UTC
 * instant it represents. Two-pass offset correction handles DST edges.
 */
export function zonedWallClockToDate(
  dateString: string,
  timeString: string,
  timeZone: string,
): Date | null {
  const date = parseDateString(dateString);
  const time = parseTimeString(timeString);
  if (!date || !time) return null;

  const utcGuess = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    time.hour,
    time.minute,
  );

  const firstOffset = timeZoneOffsetMs(utcGuess, timeZone);
  let timestamp = utcGuess - firstOffset;

  const secondOffset = timeZoneOffsetMs(timestamp, timeZone);
  if (secondOffset !== firstOffset) {
    timestamp = utcGuess - secondOffset;
  }

  return new Date(timestamp);
}

/** Current wall-clock date (`YYYY-MM-DD`) in the given timezone. */
export function todayInTimeZone(timeZone: string, now = new Date()): string {
  const wall = wallClockPartsOf(now.getTime(), timeZone);
  if (!wall) {
    return now.toISOString().slice(0, 10);
  }
  const month = String(wall.month).padStart(2, "0");
  const day = String(wall.day).padStart(2, "0");
  return `${wall.year}-${month}-${day}`;
}

/** Current wall-clock minutes-since-midnight in the given timezone. */
export function minutesOfDayInTimeZone(
  timeZone: string,
  now = new Date(),
): number {
  const wall = wallClockPartsOf(now.getTime(), timeZone);
  if (!wall) return now.getUTCHours() * 60 + now.getUTCMinutes();
  return wall.hour * 60 + wall.minute;
}

/* ------------------------------------------------------------------ *
 * Slot generation
 * ------------------------------------------------------------------ */

/**
 * Generates slot start times from opening to closing (exclusive of the
 * closing boundary) at the configured duration. Returns `[]` when the
 * configuration is invalid.
 */
export function generateSlotStarts(
  openingTime: string,
  closingTime: string,
  slotDurationMinutes: number,
): string[] {
  const opening = parseTimeString(openingTime);
  const closing = parseTimeString(closingTime);
  if (!opening || !closing) return [];
  if (
    !Number.isInteger(slotDurationMinutes) ||
    slotDurationMinutes <= 0 ||
    slotDurationMinutes > 1440
  ) {
    return [];
  }

  const openingMinutes = opening.hour * 60 + opening.minute;
  const closingMinutes = closing.hour * 60 + closing.minute;
  if (closingMinutes <= openingMinutes) return [];

  const starts: string[] = [];
  for (
    let cursor = openingMinutes;
    cursor + slotDurationMinutes <= closingMinutes;
    cursor += slotDurationMinutes
  ) {
    const hour = Math.floor(cursor / 60);
    const minute = cursor % 60;
    starts.push(
      `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    );
  }
  return starts;
}

/** End time (`HH:mm`) for a slot start at the given duration. */
export function slotEnd(start: string, slotDurationMinutes: number): string {
  const parsed = parseTimeString(start);
  if (!parsed) return start;
  const total = parsed.hour * 60 + parsed.minute + slotDurationMinutes;
  const hour = Math.floor(total / 60) % 24;
  const minute = total % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** `"09:00 – 09:30"` display label for a slot. */
export function slotLabel(start: string, slotDurationMinutes: number): string {
  return `${start} – ${slotEnd(start, slotDurationMinutes)}`;
}

/**
 * True when the slot window `[start, start + duration)` overlaps any of the
 * given windows (doctor breaks). Used to exclude break time from generated
 * availability and to reject booking attempts that would fall inside one.
 */
export function overlapsAnyWindow(
  start: string,
  durationMinutes: number,
  windows: readonly { start: string; end: string }[],
): boolean {
  const slotStart = parseTimeString(start);
  if (!slotStart || windows.length === 0) return false;
  const slotStartMin = slotStart.hour * 60 + slotStart.minute;
  const slotEndMin = slotStartMin + durationMinutes;

  for (const window of windows) {
    const from = parseTimeString(window.start);
    const to = parseTimeString(window.end);
    if (!from || !to) continue;
    const fromMin = from.hour * 60 + from.minute;
    const toMin = to.hour * 60 + to.minute;
    if (slotStartMin < toMin && slotEndMin > fromMin) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * Availability planning (pure)
 * ------------------------------------------------------------------ */

export interface SlotPlanConfig {
  date: string;
  timezone: string;
  operatingDays: number[];
  openingTime: string;
  closingTime: string;
  slotDurationMinutes: number;
  slotCapacity: number;
}

export interface SlotPlanEntry {
  start: string;
  end: string;
  label: string;
  remaining: number;
  available: boolean;
}

/**
 * Builds the verified slot plan for one laboratory date.
 *
 * A slot is only marked available when the configuration is coherent, the
 * date is an operating day, and the caller-supplied occupancy map (counted
 * from real bookings) leaves capacity. Slots whose start has already passed
 * in the laboratory's timezone are excluded from availability - nothing is
 * ever invented.
 */
export function buildSlotPlan(
  config: SlotPlanConfig,
  options: {
    /** slot start (`HH:mm`) → number of capacity-holding bookings. */
    taken?: Map<string, number>;
    now?: Date;
  } = {},
): SlotPlanEntry[] {
  const now = options.now ?? new Date();
  const taken = options.taken ?? new Map<string, number>();

  const weekday = weekdayOfDate(config.date);
  if (weekday === null) return [];
  if (!config.operatingDays.includes(weekday)) return [];

  const starts = generateSlotStarts(
    config.openingTime,
    config.closingTime,
    config.slotDurationMinutes,
  );
  if (starts.length === 0) return [];

  const entries: SlotPlanEntry[] = [];
  for (const start of starts) {
    const startAt = zonedWallClockToDate(
      config.date,
      start,
      config.timezone,
    );
    if (!startAt || startAt.getTime() <= now.getTime()) {
      // Slot already started (or timezone math failed): never offer it.
      continue;
    }

    const used = taken.get(start) ?? 0;
    const remaining = Math.max(0, config.slotCapacity - used);
    entries.push({
      start,
      end: slotEnd(start, config.slotDurationMinutes),
      label: slotLabel(start, config.slotDurationMinutes),
      remaining,
      available: remaining > 0,
    });
  }
  return entries;
}

/**
 * UTC instant before which (and after which) a booking may no longer be
 * cancelled: `cutoffHours` before the slot start in the laboratory timezone.
 */
export function cancellationDeadline(
  dateString: string,
  timeString: string,
  timeZone: string,
  cutoffHours: number,
): Date | null {
  const startAt = zonedWallClockToDate(dateString, timeString, timeZone);
  if (!startAt) return null;
  return new Date(startAt.getTime() - cutoffHours * 3_600_000);
}
