import { NextResponse } from "next/server";

import { COLLECTION_CANCELLATION_CUTOFF_HOURS } from "@/config/home-collection";
import { authErrorResponse, requireAuth } from "@/lib/auth";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import { toBookingScheduleConfigDto } from "@/lib/api/serializers";
import { connectToDatabase } from "@/lib/db";
import { getCollectionSlotOccupancy } from "@/lib/home-collection/slots";
import { Laboratory } from "@/models/Laboratory";
import { toFieldIssues } from "@/lib/validation/common";
import { homeCollectionAvailabilityQuerySchema } from "@/lib/validation/home-collection";
import {
  addDaysToDateString,
  buildSlotPlan,
  compareDateStrings,
  todayInTimeZone,
  weekdayOfDate,
} from "@/lib/utils/booking-time";
import type { HomeCollectionAvailability } from "@/types/home-collection";

export const dynamic = "force-dynamic";

/**
 * GET /api/home-collections/availability
 *
 * Returns verified availability for one laboratory date. Every slot is
 * derived from the laboratory's stored home-collection configuration (STEP 8
 * - kept distinct from in-lab booking capacity) and the real occupancy
 * counted from the collection slot ledger - nothing is fabricated. When the
 * laboratory cannot take collection requests for the requested date, the
 * response says so explicitly with `available: false` and a reason instead
 * of returning an empty or invented slot list.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireAuth();
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { searchParams } = new URL(request.url);
  const parsed = homeCollectionAvailabilityQuerySchema.safeParse({
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

    const base: HomeCollectionAvailability = {
      laboratoryId,
      date,
      available: false,
      unavailableReason: null,
      message: null,
      schedule: null,
      slots: [],
      cancellationCutoffHours: COLLECTION_CANCELLATION_CUTOFF_HOURS,
    };

    if (!laboratory.isActive) {
      return itemResponse<HomeCollectionAvailability>({
        ...base,
        unavailableReason: "LABORATORY_INACTIVE",
        message: "This laboratory is not currently accepting collection requests.",
      });
    }

    const config = laboratory.homeCollectionConfig;
    if (!config) {
      return itemResponse<HomeCollectionAvailability>({
        ...base,
        unavailableReason: "NOT_ENABLED",
        message:
          "This laboratory has not enabled home sample collection yet. Contact the laboratory directly.",
      });
    }

    const schedule = toBookingScheduleConfigDto(config);
    const withSchedule: HomeCollectionAvailability = {
      ...base,
      schedule,
    };

    const today = todayInTimeZone(config.timezone);
    const vsToday = compareDateStrings(date, today);
    if (vsToday !== null && vsToday < 0) {
      return itemResponse<HomeCollectionAvailability>({
        ...withSchedule,
        unavailableReason: "DATE_OUT_OF_RANGE",
        message: "That date has already passed.",
      });
    }

    const lastDate = addDaysToDateString(today, config.maxAdvanceDays);
    if (
      lastDate &&
      compareDateStrings(date, lastDate) !== null &&
      compareDateStrings(date, lastDate)! > 0
    ) {
      return itemResponse<HomeCollectionAvailability>({
        ...withSchedule,
        unavailableReason: "DATE_OUT_OF_RANGE",
        message: `Collections can only be requested up to ${config.maxAdvanceDays} days ahead.`,
      });
    }

    const weekday = weekdayOfDate(date);
    if (weekday === null || !config.operatingDays.includes(weekday)) {
      return itemResponse<HomeCollectionAvailability>({
        ...withSchedule,
        unavailableReason: "NOT_OPERATING_DAY",
        message: "The laboratory does not offer home collection on the selected day.",
      });
    }

    const occupancy = await getCollectionSlotOccupancy(laboratoryId, date);
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

    return itemResponse<HomeCollectionAvailability>({
      ...withSchedule,
      available: true,
      slots,
      message:
        slots.length === 0
          ? "No open pickup slots remain for the selected day."
          : null,
    });
  } catch (error) {
    logApiFailure("home-collections/availability", error);
    return errorResponse(
      503,
      "Unable to load availability right now. Please try again.",
    );
  }
}
