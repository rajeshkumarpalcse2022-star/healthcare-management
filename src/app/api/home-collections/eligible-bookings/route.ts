import { NextResponse } from "next/server";

import { COLLECTION_CAPACITY_HOLDING_STATUSES } from "@/config/home-collection";
import { authErrorResponse, requireAuth } from "@/lib/auth";
import {
  buildListMeta,
  errorResponse,
  listResponse,
  logApiFailure,
} from "@/lib/api/response";
import { toEligibleBookingRefDto } from "@/lib/api/serializers";
import { connectToDatabase } from "@/lib/db";
import { HomeCollection } from "@/models/HomeCollection";
import { LabBooking } from "@/models/LabBooking";
import { toFieldIssues } from "@/lib/validation/common";
import { homeCollectionEligibleBookingsQuerySchema } from "@/lib/validation/home-collection";

export const dynamic = "force-dynamic";

/**
 * GET /api/home-collections/eligible-bookings
 *
 * The authenticated patient's own STEP 7 bookings that can still be linked
 * to a home collection request:
 * - booking belongs to the session's patient (never a client-supplied id);
 * - booking belongs to the requested laboratory;
 * - booking is in a compatible state (PENDING or CONFIRMED);
 * - no other capacity-holding collection already references the booking.
 *
 * Standalone collection (no booking) is always permitted by the business
 * rules; this endpoint only powers the optional "link a booking" picker.
 */
export async function GET(request: Request): Promise<NextResponse> {
  let user;
  try {
    user = await requireAuth();
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { searchParams } = new URL(request.url);
  const parsed = homeCollectionEligibleBookingsQuerySchema.safeParse({
    laboratoryId: searchParams.get("laboratoryId") ?? undefined,
  });

  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your query and try again.",
      toFieldIssues(parsed.error),
    );
  }

  // Only the owning patient browses their own eligible bookings.
  if (user.role !== "PATIENT") {
    return listResponse([], buildListMeta(1, 50, 0));
  }

  const { laboratoryId } = parsed.data;

  try {
    await connectToDatabase();

    const bookings = await LabBooking.find({
      patientId: user.id,
      laboratoryId,
      status: { $in: ["PENDING", "CONFIRMED"] },
    })
      .select("bookingCode bookingDate timeSlot status items")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    if (bookings.length === 0) {
      return listResponse([], buildListMeta(1, 50, 0));
    }

    const bookingIds = bookings.map((booking) => booking._id);
    const linked = await HomeCollection.find({
      labBookingId: { $in: bookingIds },
      status: { $in: [...COLLECTION_CAPACITY_HOLDING_STATUSES] },
    })
      .select("labBookingId")
      .lean();

    const busy = new Set(
      linked.map((entry) => String(entry.labBookingId)),
    );

    const data = bookings
      .filter((booking) => !busy.has(String(booking._id)))
      .map((booking) =>
        toEligibleBookingRefDto({
          _id: booking._id,
          bookingCode: booking.bookingCode,
          status: booking.status,
          bookingDate: booking.bookingDate,
          timeSlot: booking.timeSlot,
          items: booking.items.map((item) => ({
            labTestId: item.labTestId,
            testCode: item.testCode,
            testName: item.testName,
            price: item.price,
          })),
        }),
      );

    return listResponse(data, buildListMeta(1, 50, data.length));
  } catch (error) {
    logApiFailure("home-collections/eligible-bookings", error);
    return errorResponse(
      503,
      "Unable to load eligible bookings right now. Please try again.",
    );
  }
}
