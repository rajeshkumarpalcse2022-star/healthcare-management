import { NextResponse } from "next/server";

import { authErrorResponse, requireAuth } from "@/lib/auth";
import { errorResponse, listResponse, logApiFailure, buildListMeta } from "@/lib/api/response";
import { toBookingScheduleConfigDto } from "@/lib/api/serializers";
import { connectToDatabase } from "@/lib/db";
import { Laboratory } from "@/models/Laboratory";
import type { BookableLaboratory } from "@/types/lab-booking";

export const dynamic = "force-dynamic";

/**
 * GET /api/lab-bookings/catalog
 *
 * Laboratories a logged-in patient may book with: active facilities only,
 * limited to booking-relevant fields (no registration numbers, accreditation
 * details or internal identifiers). `bookable` is false when the laboratory
 * has no online-booking configuration so the UI can show an explicit
 * unavailable state instead of leading patients into a dead-end flow.
 */
export async function GET(): Promise<NextResponse> {
  try {
    await requireAuth();
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  try {
    await connectToDatabase();

    const docs = await Laboratory.find({ isActive: true })
      .select(
        "name code city state address phone bookingConfig isActive",
      )
      .sort({ name: 1 })
      .limit(200)
      .lean();

    const data: BookableLaboratory[] = docs.map((doc) => ({
      id: String(doc._id),
      name: doc.name,
      code: doc.code,
      city: doc.city ?? null,
      state: doc.state ?? null,
      address: doc.address ?? null,
      phone: doc.phone ?? null,
      bookable: Boolean(doc.bookingConfig),
      schedule: doc.bookingConfig
        ? toBookingScheduleConfigDto(doc.bookingConfig)
        : null,
    }));

    return listResponse(data, buildListMeta(1, 200, data.length));
  } catch (error) {
    logApiFailure("lab-bookings/catalog", error);
    return errorResponse(
      503,
      "Unable to load the laboratory catalogue right now. Please try again.",
    );
  }
}
