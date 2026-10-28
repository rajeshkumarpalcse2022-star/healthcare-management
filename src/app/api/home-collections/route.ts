import { NextResponse } from "next/server";

import {
  canCreateCollection,
  canViewCollectionManagement,
} from "@/config/home-collection";
import { ROLES } from "@/config/roles";
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
import {
  toHomeCollectionDetailDto,
  toHomeCollectionSummaryDto,
  type CollectionViewerCapabilities,
} from "@/lib/api/serializers";
import { connectToDatabase } from "@/lib/db";
import { appendCollectionEvent } from "@/lib/home-collection/events";
import { nextCollectionCode } from "@/lib/home-collection/counter";
import {
  collectionOtpExpiryForPickup,
  generateCollectionOtp,
  hashCollectionOtp,
} from "@/lib/home-collection/otp";
import {
  claimCollectionSlot,
  releaseCollectionSlotQuietly,
} from "@/lib/home-collection/slots";
import { HomeCollection } from "@/models/HomeCollection";
import { Laboratory } from "@/models/Laboratory";
import { LabTest } from "@/models/LabTest";
import { LabBooking } from "@/models/LabBooking";
import { PatientProfile } from "@/models/PatientProfile";
import { User } from "@/models/User";
import { containsRegex, toFieldIssues } from "@/lib/validation/common";
import {
  homeCollectionCreateSchema,
  homeCollectionListQuerySchema,
} from "@/lib/validation/home-collection";
import {
  addDaysToDateString,
  compareDateStrings,
  generateSlotStarts,
  todayInTimeZone,
  zonedWallClockToDate,
} from "@/lib/utils/booking-time";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/** Viewer capabilities stamped on every detail response. */
const NO_CAPABILITIES: CollectionViewerCapabilities = {
  canCancel: false,
  canAssign: false,
  canConfirm: false,
  canReject: false,
  canAdvanceStatus: false,
  canRecordFailure: false,
  canRecordCollected: false,
};

/**
 * GET /api/home-collections
 *
 * Paginated collection list scoped to the caller:
 * - patients always see only their own requests;
 * - collectors always see only requests assigned to them;
 * - operational roles (super admin / admin / lab manager / staff) see every
 *   request, optionally filtered by laboratory, status, reference, collector
 *   or scheduled-date range; LAB_MANAGER and STAFF accounts with assignments
 *   only ever see requests from their own laboratories (a laboratory filter
 *   outside the scope yields an empty page).
 * List rows never carry the pickup address or contact phone.
 */
export async function GET(request: Request): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireAuth();
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const management = canViewCollectionManagement(user.role);
  const isCollector = user.role === ROLES.COLLECTOR;
  if (!management && !isCollector && user.role !== ROLES.PATIENT) {
    return errorResponse(
      403,
      "You do not have permission to view home collection requests.",
    );
  }

  const { searchParams } = new URL(request.url);
  const parsed = homeCollectionListQuerySchema.safeParse({
    search: searchParams.get("search") ?? undefined,
    status: searchParams.get("status") ?? "all",
    laboratory: searchParams.get("laboratory") ?? undefined,
    dateFrom: searchParams.get("dateFrom") ?? undefined,
    dateTo: searchParams.get("dateTo") ?? undefined,
    collector: searchParams.get("collector") ?? undefined,
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

  const { search, status, laboratory, dateFrom, dateTo, collector, page, limit } =
    parsed.data;

  const filter: Record<string, unknown> = {};
  if (!management) {
    if (isCollector) {
      // Collectors are hard-scoped to their own assignments; a client-
      // supplied collector id is never consulted.
      filter.assignedCollectorId = user.id;
    } else {
      filter.patientId = user.id;
    }
  } else {
    // Management view: LAB_MANAGER/STAFF assignments narrow the list.
    Object.assign(filter, scopeFilter(user));
    if (laboratory) {
      filter.laboratoryId = isLaboratoryInScope(user, laboratory)
        ? laboratory
        : { $in: [] };
    }
  }
  if (status !== "all") filter.status = status;
  if (search) filter.collectionCode = containsRegex(search.toUpperCase());
  if (management && collector) filter.assignedCollectorId = collector;
  if (dateFrom || dateTo) {
    const range: Record<string, Date> = {};
    if (dateFrom) range.$gte = new Date(`${dateFrom}T00:00:00.000Z`);
    if (dateTo) range.$lte = new Date(`${dateTo}T00:00:00.000Z`);
    filter.scheduledDate = range;
  }

  try {
    await connectToDatabase();

    const [total, docs] = await Promise.all([
      HomeCollection.countDocuments(filter),
      HomeCollection.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("laboratoryId", "name code isActive")
        .populate("assignedCollectorId", "name phone")
        .populate("patientId", "name")
        .lean(),
    ]);

    const summaries = docs.map((doc) => {
      const summary = toHomeCollectionSummaryDto(doc);
      if (user.role === ROLES.PATIENT) {
        const raw = doc.patientId as unknown;
        const patientRef =
          raw !== null && typeof raw === "object" && "_id" in raw
            ? String((raw as { _id: unknown })._id)
            : String(raw);
        summary.isOwnRequest = patientRef === user.id;
      }
      return summary;
    });

    return listResponse(summaries, buildListMeta(page, limit, total));
  } catch (error) {
    logApiFailure("home-collections", error);
    return errorResponse(
      503,
      "Unable to load home collection requests right now. Please try again.",
    );
  }
}

/**
 * POST /api/home-collections
 *
 * Creates a collection request after server-side verification of every
 * relationship, eligibility rule, price, date, slot and capacity claim:
 *
 * 1. the patient is resolved from the session (or, for super admin / admin,
 *    from `patientUserId` pointing at an active PATIENT account);
 * 2. the laboratory must exist, be active and have a home-collection
 *    configuration;
 * 3. every test must exist, be active and belong to that laboratory, with no
 *    duplicates;
 * 4. prices come only from the trusted catalogue, never from the request;
 * 5. any linked booking must belong to the same patient + laboratory, be in
 *    a compatible state, have its items match the selection, and have no
 *    other capacity-holding collection (enforced atomically via
 *    `activeBookingLinkKey`);
 * 6. capacity is claimed atomically in the collection slot ledger before the
 *    request is written, and released again if the write fails;
 * 7. an idempotency key replays the original request instead of creating a
 *    duplicate on client retry.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireAuth();
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  if (!canCreateCollection(user.role)) {
    return errorResponse(
      403,
      "You do not have permission to create home collection requests.",
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = homeCollectionCreateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your collection request and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const input = parsed.data;

  try {
    await connectToDatabase();

    /* ---------------- patient resolution (server-side only) ---------------- */
    let patientId: string;
    let patientPhone: string | null;

    if (user.role === ROLES.PATIENT) {
      if (
        input.patientUserId &&
        input.patientUserId.toLowerCase() !== user.id.toLowerCase()
      ) {
        return errorResponse(
          403,
          "You can only create collection requests for your own patient profile.",
        );
      }
      patientId = user.id;
      patientPhone = user.phone;
    } else {
      if (!input.patientUserId) {
        return errorResponse(
          400,
          "Select the patient this collection request is for.",
          [{ field: "patientUserId", message: "A patient account is required." }],
        );
      }
      const patient = await User.findById(input.patientUserId)
        .select("name phone role isActive")
        .lean();
      if (!patient || !patient.isActive || patient.role !== ROLES.PATIENT) {
        return errorResponse(
          400,
          "The selected patient account was not found or is not active.",
          [{ field: "patientUserId", message: "Select an active patient account." }],
        );
      }
      patientId = String(patient._id);
      patientPhone = patient.phone ?? null;
    }

    /* ---------------- deactivated patient-record guard (P1-1) ---------------- */
    // A record-level deactivate (PatientProfile.isActive === false) blocks
    // NEW collection requests for that patient regardless of who is
    // submitting. Accounts without a profile row (legacy) pass.
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
        "This laboratory is not currently accepting collection requests.",
      );
    }
    const scheduleConfig = laboratory.homeCollectionConfig;
    if (!scheduleConfig) {
      return errorResponse(
        409,
        "This laboratory has not enabled home sample collection yet.",
      );
    }

    /* ---------------- linked booking eligibility ---------------- */
    let labBookingId: string | null = null;
    if (input.labBookingId) {
      const booking = await LabBooking.findById(input.labBookingId)
        .select("patientId laboratoryId status items bookingCode")
        .lean();
      if (!booking) {
        return errorResponse(404, "The linked booking was not found.", [
          { field: "labBookingId", message: "Booking not found." },
        ]);
      }
      if (String(booking.patientId) !== patientId) {
        return errorResponse(
          403,
          "You can only link bookings that belong to this patient.",
          [{ field: "labBookingId", message: "Booking belongs to another patient." }],
        );
      }
      if (String(booking.laboratoryId) !== input.laboratoryId) {
        return errorResponse(
          409,
          "The linked booking belongs to a different laboratory.",
          [{ field: "labBookingId", message: "Choose a booking from the selected laboratory." }],
        );
      }
      if (booking.status !== "PENDING" && booking.status !== "CONFIRMED") {
        return errorResponse(
          409,
          "This booking is no longer eligible for home collection.",
          [
            {
              field: "labBookingId",
              message: "Only pending or confirmed bookings can be linked.",
            },
          ],
        );
      }
      const bookingTestIds = new Set(
        booking.items.map((item) => String(item.labTestId)),
      );
      const selectedIds = new Set(input.testIds);
      if (
        bookingTestIds.size !== selectedIds.size ||
        [...selectedIds].some((id) => !bookingTestIds.has(id))
      ) {
        return errorResponse(
          409,
          "When linking a booking, the selected tests must match the booked tests.",
          [
            {
              field: "testIds",
              message: "Select exactly the tests from the linked booking.",
            },
          ],
        );
      }
      labBookingId = String(booking._id);
    }

    /* ---------------- date and slot verification ---------------- */
    const today = todayInTimeZone(scheduleConfig.timezone);
    const vsToday = compareDateStrings(input.scheduledDate, today);
    if (vsToday === null || vsToday < 0) {
      return errorResponse(409, "Collections cannot be requested for a past date.", [
        { field: "scheduledDate", message: "Choose today or a future date." },
      ]);
    }
    const lastDate = addDaysToDateString(
      today,
      scheduleConfig.maxAdvanceDays,
    );
    if (lastDate && compareDateStrings(input.scheduledDate, lastDate)! > 0) {
      return errorResponse(
        409,
        `Collections can only be requested up to ${scheduleConfig.maxAdvanceDays} days ahead.`,
        [
          {
            field: "scheduledDate",
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
      input.scheduledDate,
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
      .select(
        "laboratoryId name code price isActive homeCollectionEnabled preparationInstructions specimenType",
      )
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
      if (test.homeCollectionEnabled === false) {
        return errorResponse(
          409,
          "One or more selected tests are not available for home collection.",
          [
            {
              field: "testIds",
              message: `${test.name} requires a lab visit. Remove it or book a lab visit instead.`,
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
      specimenType: test.specimenType ?? null,
      preparationInstructions: test.preparationInstructions ?? null,
    }));

    /* ---------------- idempotent repeat submission ---------------- */
    if (input.idempotencyKey) {
      const existing = await HomeCollection.findOne({
        idempotencyKey: input.idempotencyKey,
      })
        .populate("laboratoryId", "name code isActive")
        .populate("assignedCollectorId", "name phone")
        .lean();
      if (existing) {
        return itemResponse(
          toHomeCollectionDetailDto(existing, NO_CAPABILITIES),
          200,
        );
      }
    }

    /* ---------------- atomic capacity claim ---------------- */
    const slotKey = {
      laboratoryId: input.laboratoryId,
      date: input.scheduledDate,
      timeSlot: input.timeSlot,
    };
    const claimed = await claimCollectionSlot(
      slotKey,
      scheduleConfig.slotCapacity,
    );
    if (!claimed) {
      return errorResponse(
        409,
        "The selected pickup slot is fully booked. Choose another slot.",
        [{ field: "timeSlot", message: "No capacity left in this slot." }],
      );
    }

    /* ---------------- persist collection ---------------- */
    const contactSnapshot = {
      name: input.address.recipientName,
      phone: input.address.phone ?? patientPhone,
    };

    // OTP is generated server-side, stored only as a SHA-256 hash, and the
    // plaintext is returned exactly once in this creation response. Expiry
    // covers the whole scheduled pickup day so a later visit can still verify.
    const plainOtp = generateCollectionOtp();
    const otpHash = hashCollectionOtp(plainOtp);
    const scheduledDateUtc = new Date(`${input.scheduledDate}T00:00:00.000Z`);
    const otpExpiresAt = collectionOtpExpiryForPickup(scheduledDateUtc);

    let collection;
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          collection = await HomeCollection.create({
            collectionCode: await nextCollectionCode(),
            patientId,
            laboratoryId: input.laboratoryId,
            labBookingId: labBookingId,
            items: snapshots,
            collectionAddress: {
              recipientName: input.address.recipientName,
              phone: input.address.phone,
              addressLine1: input.address.addressLine1,
              addressLine2: input.address.addressLine2 ?? null,
              landmark: input.address.landmark ?? null,
              city: input.address.city,
              state: input.address.state,
              pincode: input.address.pincode,
              latitude: input.address.latitude ?? null,
              longitude: input.address.longitude ?? null,
              instructions: input.address.instructions ?? null,
            },
            scheduledDate: scheduledDateUtc,
            timeSlot: input.timeSlot,
            timezone: scheduleConfig.timezone,
            status: "PENDING",
            assignedCollectorId: null,
            patientContactSnapshot: contactSnapshot,
            collectionNotes: input.collectionInstructions ?? null,
            otpHash,
            otpExpiresAt,
            otpIssuedAt: new Date(),
            otpAttempts: 0,
            activeBookingLinkKey: labBookingId,
            createdBy: user.id,
            idempotencyKey: input.idempotencyKey ?? null,
          });
          break;
        } catch (error) {
          if (!isDuplicateKeyError(error)) throw error;

          // Distinguish the unique indexes: an idempotency replay means
          // the original request won the race - return it. An
          // activeBookingLinkKey clash means another collection already
          // holds this booking. Anything else (booking-code collision,
          // astronomically rare) retries.
          if (input.idempotencyKey) {
            const existing = await HomeCollection.findOne({
              idempotencyKey: input.idempotencyKey,
            })
              .populate("laboratoryId", "name code isActive")
              .populate("assignedCollectorId", "name phone")
              .lean();
            if (existing) {
              await releaseCollectionSlotQuietly(slotKey);
              return itemResponse(
                toHomeCollectionDetailDto(existing, NO_CAPABILITIES),
                200,
              );
            }
          }
          if (labBookingId) {
            const existingLink = await HomeCollection.findOne({
              activeBookingLinkKey: labBookingId,
            })
              .select("collectionCode")
              .lean();
            if (existingLink) {
              await releaseCollectionSlotQuietly(slotKey);
              return errorResponse(
                409,
                "This booking already has an active home collection request.",
                [
                  {
                    field: "labBookingId",
                    message: `Reference ${existingLink.collectionCode} already covers this booking.`,
                  },
                ],
              );
            }
          }
          if (attempt >= 2) throw error;
        }
      }
    } catch (error) {
      await releaseCollectionSlotQuietly(slotKey);
      throw error;
    }

    await appendCollectionEvent({
      collectionId: String(collection._id),
      eventType: "REQUEST_CREATED",
      previousStatus: null,
      newStatus: "PENDING",
      actorId: user.id,
    });

    const populated = await HomeCollection.findById(collection._id)
      .populate("laboratoryId", "name code isActive")
      .populate("assignedCollectorId", "name phone")
      .lean();

    // OTP plaintext is returned exactly once here. It is never persisted,
    // never logged and never re-exposed by list or detail endpoints.
    const detail = toHomeCollectionDetailDto(populated ?? collection.toObject(), {
      ...NO_CAPABILITIES,
      canCancel: user.role === ROLES.PATIENT || user.role === ROLES.SUPER_ADMIN || user.role === ROLES.ADMIN,
    });

    return itemResponse(
      {
        ...detail,
        collectionOtp: plainOtp,
        collectionOtpExpiresAt: otpExpiresAt.toISOString(),
      },
      201,
    );
  } catch (error) {
    logApiFailure("home-collections/create", error);
    return errorResponse(
      503,
      "Unable to create the collection request right now. Please try again.",
    );
  }
}
