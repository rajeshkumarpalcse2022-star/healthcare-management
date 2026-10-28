import { NextResponse } from "next/server";

import {
  canCreateBooking,
  canCreateBookingForOthers,
  canViewBookingManagement,
} from "@/config/lab-bookings";
import {
  authErrorResponse,
  isLaboratoryInScope,
  requireAuth,
  scopeFilter,
} from "@/lib/auth";
import {
  buildListMeta,
  errorResponse,
  isDuplicateKeyError,
  itemResponse,
  listResponse,
  logApiFailure,
} from "@/lib/api/response";
import { toLabBookingDetailDto, toLabBookingSummaryDto } from "@/lib/api/serializers";
import { connectToDatabase } from "@/lib/db";
import { claimSlot, releaseSlotQuietly } from "@/lib/lab-booking/slots";
import { appendBookingEvent } from "@/lib/lab-booking/events";
import { nextBookingCode } from "@/lib/lab-booking/counter";
import { LabBooking } from "@/models/LabBooking";
import { Laboratory } from "@/models/Laboratory";
import { LabTest } from "@/models/LabTest";
import { PatientProfile } from "@/models/PatientProfile";
import { User } from "@/models/User";
import { containsRegex, toFieldIssues } from "@/lib/validation/common";
import {
  labBookingCreateSchema,
  labBookingListQuerySchema,
} from "@/lib/validation/lab-booking";
import {
  addDaysToDateString,
  compareDateStrings,
  generateSlotStarts,
  todayInTimeZone,
  zonedWallClockToDate,
} from "@/lib/utils/booking-time";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/lab-bookings
 *
 * Paginated booking list scoped to the caller:
 * - patients always see only their own bookings;
 * - operational roles (super admin / admin / lab manager / staff) see
 *   bookings, optionally filtered by laboratory, status or reference;
 * - LAB_MANAGER and STAFF accounts with assignments only ever see bookings
 *   from their own laboratories (a laboratory filter outside the scope
 *   yields an empty page).
 */
export async function GET(request: Request): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireAuth();
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const management = canViewBookingManagement(user.role);
  if (!management && user.role !== "PATIENT") {
    return errorResponse(403, "You do not have permission to view lab bookings.");
  }

  const { searchParams } = new URL(request.url);
  const parsed = labBookingListQuerySchema.safeParse({
    search: searchParams.get("search") ?? undefined,
    status: searchParams.get("status") ?? "all",
    laboratory: searchParams.get("laboratory") ?? undefined,
    page: searchParams.get("page") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your search parameters and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const { search, status, laboratory, page, limit } = parsed.data;

  const filter: Record<string, unknown> = {};
  if (!management) {
    // Patients are hard-scoped to their own records; a client-supplied
    // patient id is never consulted.
    filter.patientId = user.id;
  } else {
    // Management view: LAB_MANAGER/STAFF assignments narrow the list.
    Object.assign(filter, scopeFilter(user));
    if (laboratory) {
      filter.laboratoryId = isLaboratoryInScope(user, laboratory)
        ? laboratory
        : { $in: [] };
    }
  }
  if (status === "REVIEWED") {
    // Filter-only value: everything except the requests still awaiting
    // lab-manager review (those live in the central Collection Requests
    // queue). Never a persisted status.
    filter.status = { $ne: "PENDING" };
  } else if (status !== "all") {
    filter.status = status;
  }
  if (search) filter.bookingCode = containsRegex(search.toUpperCase());

  try {
    await connectToDatabase();

    const [total, docs] = await Promise.all([
      LabBooking.countDocuments(filter),
      LabBooking.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("laboratoryId", "name code isActive")
        .populate("patientId", "name")
        .lean(),
    ]);

    return listResponse(
      docs.map(toLabBookingSummaryDto),
      buildListMeta(page, limit, total),
    );
  } catch (error) {
    logApiFailure("lab-bookings", error);
    return errorResponse(
      503,
      "Unable to load lab bookings right now. Please try again.",
    );
  }
}

/**
 * POST /api/lab-bookings
 *
 * Creates a booking after server-side verification of every relationship,
 * eligibility rule, price, date, slot and capacity claim:
 *
 * 1. the patient is resolved from the session (or, for super admin / admin,
 *    from `patientUserId` pointing at an active PATIENT account) - a patient
 *    can never book on behalf of someone else;
 * 2. the laboratory must exist, be active and have a booking configuration;
 * 3. every test must exist, be active and belong to that laboratory, with no
 *    duplicates;
 * 4. prices come only from the trusted catalogue, never from the request;
 * 5. capacity is claimed atomically in the slot ledger before the booking is
 *    written, and released again if the write fails.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireAuth();
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  if (!canCreateBooking(user.role)) {
    return errorResponse(403, "You do not have permission to create lab bookings.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = labBookingCreateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your booking details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const input = parsed.data;

  try {
    await connectToDatabase();

    /* ---------------- patient resolution (server-side only) ---------------- */
    let patientId: string;
    let patientName: string;
    let patientEmail: string | null;
    let patientPhone: string | null;

    if (user.role === "PATIENT") {
      if (
        input.patientUserId &&
        input.patientUserId.toLowerCase() !== user.id.toLowerCase()
      ) {
        return errorResponse(
          403,
          "You can only create bookings for your own patient profile.",
        );
      }
      patientId = user.id;
      patientName = user.name;
      patientEmail = user.email;
      patientPhone = user.phone;
    } else {
      if (!canCreateBookingForOthers(user.role)) {
        return errorResponse(
          403,
          "You do not have permission to create bookings on behalf of patients.",
        );
      }
      if (!input.patientUserId) {
        return errorResponse(
          400,
          "Select the patient this booking is for.",
          [{ field: "patientUserId", message: "A patient account is required." }],
        );
      }
      const patient = await User.findById(input.patientUserId)
        .select("name email phone role isActive")
        .lean();
      if (!patient || !patient.isActive || patient.role !== "PATIENT") {
        return errorResponse(
          400,
          "The selected patient account was not found or is not active.",
          [{ field: "patientUserId", message: "Select an active patient account." }],
        );
      }
      patientId = String(patient._id);
      patientName = patient.name;
      patientEmail = patient.email;
      patientPhone = patient.phone ?? null;
    }

    /* ---------------- deactivated patient-record guard (P1-1) ---------------- */
    // A record-level deactivate (PatientProfile.isActive === false) blocks
    // NEW bookings for that patient regardless of who is submitting. Accounts
    // without a profile row (legacy) pass - there is nothing to deactivate.
    const patientProfile = await PatientProfile.findOne({
      userId: patientId,
    })
      .select("isActive")
      .lean();
    if (patientProfile && patientProfile.isActive === false) {
      return errorResponse(
        403,
        "This patient's record is deactivated. Contact an administrator to reactivate it.",
      );
    }

    /* ---------------- laboratory eligibility ---------------- */
    const laboratory = await Laboratory.findById(input.laboratoryId).lean();
    if (!laboratory) {
      return errorResponse(404, "Laboratory not found.");
    }
    if (!laboratory.isActive) {
      return errorResponse(
        409,
        "This laboratory is not currently accepting bookings.",
      );
    }
    const scheduleConfig = laboratory.bookingConfig;
    if (!scheduleConfig) {
      return errorResponse(
        409,
        "This laboratory has not configured online booking yet.",
      );
    }

    /* ---------------- date and slot verification ---------------- */
    const today = todayInTimeZone(scheduleConfig.timezone);
    const vsToday = compareDateStrings(input.bookingDate, today);
    if (vsToday === null || vsToday < 0) {
      return errorResponse(409, "Bookings cannot be made for a past date.", [
        { field: "bookingDate", message: "Choose today or a future date." },
      ]);
    }
    const lastDate = addDaysToDateString(
      today,
      scheduleConfig.maxAdvanceDays,
    );
    if (lastDate && compareDateStrings(input.bookingDate, lastDate)! > 0) {
      return errorResponse(
        409,
        `Bookings can only be made up to ${scheduleConfig.maxAdvanceDays} days ahead.`,
        [
          {
            field: "bookingDate",
            message: `Choose a date on or before ${lastDate}.`,
          },
        ],
      );
    }

    const validStarts = generateSlotStarts(
      scheduleConfig.openingTime,
      scheduleConfig.closingTime,
      scheduleConfig.slotDurationMinutes,
    );
    if (!validStarts.includes(input.timeSlot)) {
      return errorResponse(409, "The selected time slot is not offered.", [
        { field: "timeSlot", message: "Pick a slot from the available list." },
      ]);
    }

    const startAt = zonedWallClockToDate(
      input.bookingDate,
      input.timeSlot,
      scheduleConfig.timezone,
    );
    if (!startAt || startAt.getTime() <= Date.now()) {
      return errorResponse(409, "The selected time slot has already passed.", [
        { field: "timeSlot", message: "Choose a later slot." },
      ]);
    }

    /* ---------------- test eligibility (prices from the catalogue) --------- */
    const tests = await LabTest.find({
      _id: { $in: input.testIds },
    })
      .select("laboratoryId name code price isActive labVisitEnabled")
      .lean();

    if (tests.length !== input.testIds.length) {
      return errorResponse(409, "One or more selected tests were not found.", [
        { field: "testIds", message: "Refresh the test list and try again." },
      ]);
    }

    const items = input.testIds.map((testId) => {
      const test = tests.find((candidate) => String(candidate._id) === testId);
      return test!;
    });

    for (const test of items) {
      if (String(test.laboratoryId) !== input.laboratoryId) {
        return errorResponse(
          409,
          "Every selected test must belong to the selected laboratory.",
          [{ field: "testIds", message: "One or more tests belong to another laboratory." }],
        );
      }
      if (!test.isActive) {
        return errorResponse(409, "One or more selected tests are unavailable.", [
          { field: "testIds", message: `${test.name} is not currently offered.` },
        ]);
      }
      if (test.labVisitEnabled === false) {
        return errorResponse(
          409,
          "One or more selected tests are not available for a lab visit.",
          [
            {
              field: "testIds",
              message: `${test.name} is home-collection only. Remove it or request a home collection instead.`,
            },
          ],
        );
      }
    }

    const snapshots = items.map((test) => ({
      labTestId: test._id,
      testCode: test.code,
      testName: test.name,
      price: test.price,
    }));
    const totalAmount = snapshots.reduce((sum, item) => sum + item.price, 0);

    /* ---------------- idempotent repeat submission ---------------- */
    if (input.idempotencyKey) {
      const existing = await LabBooking.findOne({
        idempotencyKey: input.idempotencyKey,
      })
        .populate("laboratoryId", "name code isActive")
        .lean();
      if (existing) {
        return itemResponse(toLabBookingDetailDto(existing), 200);
      }
    }

    /* ---------------- atomic capacity claim ---------------- */
    const slotKey = {
      laboratoryId: input.laboratoryId,
      date: input.bookingDate,
      timeSlot: input.timeSlot,
    };
    const claimed = await claimSlot(slotKey, scheduleConfig.slotCapacity);
    if (!claimed) {
      return errorResponse(
        409,
        "The selected time slot is fully booked. Choose another slot.",
        [{ field: "timeSlot", message: "No capacity left in this slot." }],
      );
    }

    /* ---------------- persist booking ---------------- */
    const contactSnapshot = {
      name: patientName,
      email: input.contact?.email ?? patientEmail,
      phone: input.contact?.phone ?? patientPhone,
    };

    let booking;
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          booking = await LabBooking.create({
            bookingCode: await nextBookingCode(),
            patientId,
            laboratoryId: input.laboratoryId,
            items: snapshots,
            bookingDate: new Date(`${input.bookingDate}T00:00:00.000Z`),
            timeSlot: input.timeSlot,
            timezone: scheduleConfig.timezone,
            patientContactSnapshot: contactSnapshot,
            status: "PENDING",
            totalAmount,
            notes: input.notes ?? null,
            createdBy: user.id,
            idempotencyKey: input.idempotencyKey ?? null,
          });
          break;
        } catch (error) {
          if (!isDuplicateKeyError(error)) throw error;

          // Distinguish the two unique indexes: an idempotency replay means
          // the original booking won the race - return it. A booking-code
          // clash means the counter collided (astronomically rare) - retry.
          if (input.idempotencyKey) {
            const existing = await LabBooking.findOne({
              idempotencyKey: input.idempotencyKey,
            })
              .populate("laboratoryId", "name code isActive")
              .lean();
            if (existing) {
              await releaseSlotQuietly(slotKey);
              return itemResponse(toLabBookingDetailDto(existing), 200);
            }
          }
          if (attempt >= 2) throw error;
        }
      }
    } catch (error) {
      await releaseSlotQuietly(slotKey);
      throw error;
    }

    await appendBookingEvent({
      bookingId: String(booking._id),
      eventType: "REQUEST_CREATED",
      previousStatus: null,
      newStatus: "PENDING",
      actorId: user.id,
    });

    const populated = await LabBooking.findById(booking._id)
      .populate("laboratoryId", "name code isActive")
      .populate("patientId", "name")
      .lean();

    return itemResponse(
      toLabBookingDetailDto(populated ?? booking.toObject()),
      201,
    );
  } catch (error) {
    logApiFailure("lab-bookings/create", error);
    return errorResponse(
      503,
      "Unable to create the booking right now. Please try again.",
    );
  }
}
