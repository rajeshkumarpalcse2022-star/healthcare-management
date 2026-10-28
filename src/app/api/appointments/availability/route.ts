import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireAuth } from "@/lib/auth";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import { getDoctorProfileById } from "@/lib/appointment/authorization";
import {
  doctorClinicIds,
  getDoctorClinicSchedule,
} from "@/lib/appointment/clinic-assignments";
import { toScheduleConfigDto } from "@/lib/appointment/dto";
import { effectiveScheduleForDate } from "@/lib/appointment/schedule-conflicts";
import { getAppointmentSlotOccupancy } from "@/lib/appointment/slots";
import { connectToDatabase } from "@/lib/db";
import { Clinic } from "@/models/Clinic";
import { toFieldIssues } from "@/lib/validation/common";
import { appointmentAvailabilityQuerySchema } from "@/lib/validation/appointment";
import {
  addDaysToDateString,
  buildSlotPlan,
  compareDateStrings,
  overlapsAnyWindow,
  todayInTimeZone,
} from "@/lib/utils/booking-time";
import type { AppointmentAvailability, AppointmentSlot } from "@/types/appointment";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

const DIRECTORY_ROLES: string[] = [
  ROLES.PATIENT,
  ROLES.DOCTOR,
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
];

/**
 * GET /api/appointments/availability
 *
 * Returns verified availability for one doctor date. Every slot is derived
 * from the doctor's stored schedule and the real occupancy counted from the
 * slot ledger - nothing is fabricated. Break windows are excluded entirely
 * and leave dates are reported explicitly. When the doctor cannot take
 * appointments for the requested date, the response says so with
 * `bookable: false` and a reason instead of returning an invented list.
 */
export async function GET(request: Request): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireAuth();
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  if (!DIRECTORY_ROLES.includes(user.role)) {
    return errorResponse(403, "You do not have permission to view availability.");
  }

  const { searchParams } = new URL(request.url);
  const parsed = appointmentAvailabilityQuerySchema.safeParse({
    doctorId: searchParams.get("doctorId") ?? undefined,
    clinicId: searchParams.get("clinicId") ?? undefined,
    date: searchParams.get("date") ?? undefined,
  });

  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your availability query and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const { doctorId, date } = parsed.data;

  try {
    await connectToDatabase();

    const doctor = await getDoctorProfileById(doctorId);
    if (!doctor) {
      return errorResponse(404, "Doctor not found.");
    }

    const clinicId = parsed.data.clinicId ?? doctorClinicIds(doctor)[0];
    if (!clinicId || !doctorClinicIds(doctor).includes(clinicId)) {
      return errorResponse(
        404,
        "This doctor does not practise at the selected clinic.",
      );
    }

    const clinic = await Clinic.findById(clinicId)
      .select("name isActive")
      .lean();
    if (!clinic) {
      return errorResponse(404, "Clinic not found.");
    }

    const base: AppointmentAvailability = {
      doctorId,
      clinicId,
      clinicName: clinic.name,
      date,
      bookable: false,
      unavailableReason: null,
      message: null,
      schedule: null,
      dateSchedule: null,
      slots: [],
    };

    if (!doctor.isActive) {
      return itemResponse<AppointmentAvailability>({
        ...base,
        unavailableReason: "DOCTOR_INACTIVE",
        message: "This doctor is not currently accepting appointments.",
      });
    }

    if (!clinic.isActive) {
      return itemResponse<AppointmentAvailability>({
        ...base,
        unavailableReason: "CLINIC_INACTIVE",
        message: "This doctor's clinic is not currently accepting appointments.",
      });
    }

    const config = getDoctorClinicSchedule(doctor, clinicId);
    if (!config) {
      return itemResponse<AppointmentAvailability>({
        ...base,
        unavailableReason: "NOT_CONFIGURED",
        message:
          "This doctor has not configured appointment availability yet.",
      });
    }

    const schedule = toScheduleConfigDto(config);
    const effective = effectiveScheduleForDate(config, date);
    const withSchedule: AppointmentAvailability = {
      ...base,
      schedule,
      dateSchedule: effective,
    };

    const today = todayInTimeZone(config.timezone);
    const vsToday = compareDateStrings(date, today);
    if (vsToday !== null && vsToday < 0) {
      return itemResponse<AppointmentAvailability>({
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
      return itemResponse<AppointmentAvailability>({
        ...withSchedule,
        unavailableReason: "DATE_OUT_OF_RANGE",
        message: `Appointments can only be made up to ${config.maxAdvanceDays} days ahead.`,
      });
    }

    if (!effective) {
      const override = config.dateOverrides?.find(
        (entry) => entry.date === date,
      );
      const closed =
        override?.isClosed || config.unavailableDates?.includes(date);
      return itemResponse<AppointmentAvailability>({
        ...withSchedule,
        unavailableReason: closed ? "DATE_UNAVAILABLE" : "NOT_OPERATING_DAY",
        message: closed
          ? "The doctor is unavailable on the selected date."
          : "The doctor does not consult on the selected day.",
      });
    }

    const occupancy = await getAppointmentSlotOccupancy(doctorId, date);
    const slots: AppointmentSlot[] = buildSlotPlan(
      {
        date,
        timezone: config.timezone,
        operatingDays: [0, 1, 2, 3, 4, 5, 6],
        openingTime: effective.openingTime,
        closingTime: effective.closingTime,
        slotDurationMinutes: effective.slotDurationMinutes,
        slotCapacity: effective.slotCapacity,
      },
      { taken: occupancy },
    ).filter(
      (entry) =>
        // Break windows are never offered - they are not bookable time.
        !overlapsAnyWindow(
          entry.start,
          effective.slotDurationMinutes,
          effective.breaks,
        ),
    );

    return itemResponse<AppointmentAvailability>({
      ...withSchedule,
      bookable: true,
      slots,
      message:
        slots.length === 0
          ? "No bookable slots remain for the selected day."
          : null,
    });
  } catch (error) {
    logApiFailure("appointments/availability", error);
    return errorResponse(
      503,
      "Unable to load availability right now. Please try again.",
    );
  }
}
