import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import {
  buildListMeta,
  errorResponse,
  isDuplicateKeyError,
  itemResponse,
  listResponse,
  logApiFailure,
} from "@/lib/api/response";
import { toClinicDto } from "@/lib/api/serializers";
import { Clinic } from "@/models/Clinic";
import {
  clinicCreateSchema,
  clinicListQuerySchema,
} from "@/lib/validation/clinic";
import {
  containsRegex,
  statusToBoolean,
  toFieldIssues,
} from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/**
 * GET /api/clinics
 *
 * Paginated clinic directory with server-side search and status filtering.
 * Requires SUPER_ADMIN or ADMIN - clinic administration is not available to
 * other roles.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { searchParams } = new URL(request.url);
  const parsed = clinicListQuerySchema.safeParse({
    search: searchParams.get("search") ?? undefined,
    status: searchParams.get("status") ?? "all",
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

  const { search, status, page, limit } = parsed.data;
  const isActive = statusToBoolean(status);

  const filter: Record<string, unknown> = {};
  if (isActive !== undefined) filter.isActive = isActive;
  if (search) {
    filter.$or = [
      { name: containsRegex(search) },
      { code: containsRegex(search) },
      { city: containsRegex(search) },
    ];
  }

  try {
    await connectToDatabase();

    const [total, docs] = await Promise.all([
      Clinic.countDocuments(filter),
      Clinic.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    return listResponse(docs.map(toClinicDto), buildListMeta(page, limit, total));
  } catch (error) {
    logApiFailure("clinics", error);
    return errorResponse(
      503,
      "Unable to load clinics right now. Please try again.",
    );
  }
}

/**
 * POST /api/clinics
 *
 * Creates a clinic. Duplicate business codes are rejected with 409 before the
 * insert; the unique index is the final guard.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    await requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = clinicCreateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  try {
    await connectToDatabase();

    const existing = await Clinic.findOne({ code: parsed.data.code })
      .select("_id")
      .lean();
    if (existing) {
      return errorResponse(
        409,
        "A clinic with this code already exists. Choose a different code.",
      );
    }

    const clinic = await Clinic.create({
      name: parsed.data.name,
      code: parsed.data.code,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email ?? null,
      address: parsed.data.address ?? null,
      city: parsed.data.city ?? null,
      state: parsed.data.state ?? null,
      pincode: parsed.data.pincode ?? null,
      registrationNumber: parsed.data.registrationNumber ?? null,
      imageUrl: parsed.data.imageUrl ?? null,
      latitude: parsed.data.latitude ?? null,
      longitude: parsed.data.longitude ?? null,
      isActive: true,
    });

    return itemResponse(toClinicDto(clinic.toObject()), 201);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return errorResponse(
        409,
        "A clinic with this code already exists. Choose a different code.",
      );
    }
    logApiFailure("clinics/create", error);
    return errorResponse(
      503,
      "Unable to create the clinic right now. Please try again.",
    );
  }
}
