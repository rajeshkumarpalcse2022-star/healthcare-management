import { NextResponse } from "next/server";

import { authErrorResponse, requireAuth } from "@/lib/auth";
import {
  buildListMeta,
  errorResponse,
  listResponse,
  logApiFailure,
} from "@/lib/api/response";
import { toBookableTestDto } from "@/lib/api/serializers";
import { connectToDatabase } from "@/lib/db";
import { LabTest } from "@/models/LabTest";
import { Laboratory } from "@/models/Laboratory";
// Import side-effect: registers the "LabDepartment" model that
// `LabTest.departmentId` references by name. Without it, `.populate()`
// throws MissingSchemaError and this route always returns 503.
import "@/models/LabDepartment";
import { containsRegex, toFieldIssues } from "@/lib/validation/common";
import { labBookingTestsQuerySchema } from "@/lib/validation/lab-booking";

export const dynamic = "force-dynamic";

/**
 * GET /api/lab-bookings/catalog/tests
 *
 * Active, currently offered tests for one laboratory - the bookable slice of
 * the test catalogue. The laboratory must exist and be active; every returned
 * test belongs to it. Department / category / search filters narrow the list.
 * Internal catalogue management stays behind the lab-module roles; this
 * endpoint only ever exposes booking-relevant fields.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireAuth();
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { searchParams } = new URL(request.url);
  const parsed = labBookingTestsQuerySchema.safeParse({
    laboratoryId: searchParams.get("laboratoryId") ?? undefined,
    department: searchParams.get("department") ?? undefined,
    category: searchParams.get("category") ?? undefined,
    search: searchParams.get("search") ?? undefined,
  });

  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your query parameters and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const { laboratoryId, department, category, search } = parsed.data;

  try {
    await connectToDatabase();

    const laboratory = await Laboratory.findById(laboratoryId)
      .select("_id isActive")
      .lean();
    if (!laboratory) {
      return errorResponse(404, "Laboratory not found.");
    }
    if (!laboratory.isActive) {
      return errorResponse(
        409,
        "This laboratory is not currently accepting bookings.",
      );
    }

    const filter: Record<string, unknown> = {
      laboratoryId,
      isActive: true,
    };
    if (department) filter.departmentId = department;
    if (category) filter.category = category;
    if (search) {
      filter.$or = [
        { name: containsRegex(search) },
        { code: containsRegex(search) },
      ];
    }

    const docs = await LabTest.find(filter)
      .select(
        "departmentId name code category specimenType turnaroundTimeMinutes price labVisitEnabled homeCollectionEnabled preparationInstructions",
      )
      .sort({ name: 1 })
      .limit(200)
      .populate("departmentId", "name code")
      .lean();

    const data = docs.map(toBookableTestDto);
    return listResponse(data, buildListMeta(1, 200, data.length));
  } catch (error) {
    logApiFailure("lab-bookings/catalog/tests", error);
    return errorResponse(
      503,
      "Unable to load lab tests right now. Please try again.",
    );
  }
}
