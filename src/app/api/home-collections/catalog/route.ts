import { NextResponse } from "next/server";

import { authErrorResponse, requireAuth } from "@/lib/auth";
import {
  buildListMeta,
  errorResponse,
  listResponse,
  logApiFailure,
} from "@/lib/api/response";
import { toBookingScheduleConfigDto } from "@/lib/api/serializers";
import { connectToDatabase } from "@/lib/db";
import { Laboratory } from "@/models/Laboratory";
import type { CollectableLaboratory } from "@/types/home-collection";

export const dynamic = "force-dynamic";

/**
 * GET /api/home-collections/catalog
 *
 * Laboratories a logged-in user may request home collection from: active
 * facilities only, limited to public contact fields (no registration numbers,
 * accreditation details or internal identifiers). `collectable` is false
 * when the laboratory has not enabled home collection, so the UI can show an
 * explicit unavailable state instead of leading patients into a dead-end
 * flow. Availability for a specific date is always re-verified separately.
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
        "name code city state address phone homeCollectionConfig isActive",
      )
      .sort({ name: 1 })
      .limit(200)
      .lean();

    const data: CollectableLaboratory[] = docs.map((doc) => ({
      id: String(doc._id),
      name: doc.name,
      code: doc.code,
      city: doc.city ?? null,
      state: doc.state ?? null,
      address: doc.address ?? null,
      phone: doc.phone ?? null,
      collectable: Boolean(doc.homeCollectionConfig),
      schedule: doc.homeCollectionConfig
        ? toBookingScheduleConfigDto(doc.homeCollectionConfig)
        : null,
    }));

    return listResponse(data, buildListMeta(1, 200, data.length));
  } catch (error) {
    logApiFailure("home-collections/catalog", error);
    return errorResponse(
      503,
      "Unable to load the laboratory catalogue right now. Please try again.",
    );
  }
}
