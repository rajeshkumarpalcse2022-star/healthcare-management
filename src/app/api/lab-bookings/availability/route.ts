import { NextResponse } from "next/server";

import { CANCELLATION_CUTOFF_HOURS } from "@/config/lab-bookings";
import { authErrorResponse, requireAuth } from "@/lib/auth";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import { toBookingScheduleConfigDto } from "@/lib/api/serializers";
import { connectToDatabase } from "@/lib/db";
import { getSlotOccupancy } from "@/lib/lab-booking/slots";
import { Laboratory } from "@/models/Laboratory";
import { toFieldIssues } from "@/lib/validation/common";
import { labBookingAvailabilityQuerySchema } from "@/lib/validation/lab-booking";
import {
  addDaysToDateString,
  buildSlotPlan,
  compareDateStrings,
  todayInTimeZone,
  weekdayOfDate,
} from "@/lib/utils/booking-time";
import type { LabBookingAvailability } from "@/types/lab-booking";

export const dynamic = "force-dynamic";

/**
 * GET /api/lab-bookings/availability
 *
 * Returns verified availability for one laboratory date. Every slot is
 * derived from the laboratory's stored operating configuration and the real
 * occupancy counted from the slot ledger - nothing is fabricated. When the
 * laboratory cannot take bookings for the requested date, the response says
 * so explicitly with `bookable: false` and a reason instead of returning an
 * empty or invented slot list.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireAuth();
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { searchParams } = new URL(request.url);
  const parsed = labBookingAvailabilityQuerySchema.safeParse({
    laboratoryId: searchParams.get("laboratoryId") ?? undefined,
    date: searchParams.get("date") ?? undefined,
  });

  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your availability query and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const { laboratoryId, date } = parsed.data;

  try {
    await connectToDatabase();

    const laboratory = await Laboratory.findById(laboratoryId).lean();
    if (!laboratory) {
      return errorResponse(404, "Laboratory not found.");
    }

    const base: LabBookingAvailability = {
      laboratoryId,
      date,
      bookable: false,
      unavailableReason: null,
      message: null,
      schedule: null,
      slots: [],
      cancellationCutoffHours: CANCELLATION_CUTOFF_HOURS,
    };

    if (!laboratory.isActive) {
      return itemResponse<LabBookingAvailability>({
        ...base,
        unavailableReason: "LABORATORY_INACTIVE",
        message: "This laboratory is not currently accepting bookings.",
      });
    }

    const config = laboratory.bookingConfig;
    if (!config) {
      return itemResponse<LabBookingAvailability>({
        ...base,
        unavailableReason: "NOT_CONFIGURED",
        message:
          "This laboratory has not configured online booking yet. Contact the laboratory directly.",
      });
    }

    const schedule = toBookingScheduleConfigDto(config);
    const withSchedule: LabBookingAvailability = {
      ...base,
      schedule,
    };

    const today = todayInTimeZone(config.timezone);
    const vsToday = compareDateStrings(date, today);
    if (vsToday !== null && vsToday < 0) {
      return itemResponse<LabBookingAvailability>({
        ...withSchedule,
        unavailableReason: "DATE_OUT_OF_RANGE",
        message: "That date has already passed.",
      });
    }

    const lastDate = addDaysToDateString(today, config.maxAdvanceDays);
    if (lastDate && compareDateStrings(date, lastDate) !== null && compareDateStrings(date, lastDate)! > 0) {
      return itemResponse<LabBookingAvailability>({
        ...withSchedule,
        unavailableReason: "DATE_OUT_OF_RANGE",
        message: `Bookings can only be made up to ${config.maxAdvanceDays} days ahead.`,
      });
    }

    const weekday = weekdayOfDate(date);
    if (weekday === null || !config.operatingDays.includes(weekday)) {
      return itemResponse<LabBookingAvailability>({
        ...withSchedule,
        unavailableReason: "NOT_OPERATING_DAY",
        message: "The laboratory does not operate on the selected day.",
      });
    }

    const occupancy = await getSlotOccupancy(laboratoryId, date);
    const slots = buildSlotPlan(
      {
        date,
        timezone: config.timezone,
        operatingDays: [...config.operatingDays],
        openingTime: config.openingTime,
        closingTime: config.closingTime,
        slotDurationMinutes: config.slotDurationMinutes,
        slotCapacity: config.slotCapacity,
      },
      { taken: occupancy },
    );

    return itemResponse<LabBookingAvailability>({
      ...withSchedule,
      bookable: true,
      slots,
      message:
        slots.length === 0
          ? "No bookable slots remain for the selected day."
          : null,
    });
  } catch (error) {
    logApiFailure("lab-bookings/availability", error);
    return errorResponse(
      503,
      "Unable to load availability right now. Please try again.",
    );
  }
}
