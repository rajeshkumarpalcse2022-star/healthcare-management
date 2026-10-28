import { NextResponse } from "next/server";

import { LAB_READ_ROLES } from "@/config/labs";
import { ROLES } from "@/config/roles";
import { authErrorResponse, requireRole, scopeFilter } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import type { SafeUser } from "@/types/auth";
import {
  buildListMeta,
  errorResponse,
  isDuplicateKeyError,
  itemResponse,
  listResponse,
  logApiFailure,
} from "@/lib/api/response";
import { toLaboratoryDto } from "@/lib/api/serializers";
import { Laboratory } from "@/models/Laboratory";
import {
  laboratoryCreateSchema,
  laboratoryListQuerySchema,
} from "@/lib/validation/laboratory";
import {
  containsRegex,
  statusToBoolean,
  toFieldIssues,
} from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/**
 * GET /api/laboratories
 *
 * Paginated laboratory directory with server-side search and status
 * filtering. Readable by lab management, staff and doctors. LAB_MANAGER and
 * STAFF accounts are restricted to their assigned laboratories; accounts
 * without a scope (SUPER_ADMIN, ADMIN, DOCTOR, legacy documents) see the
 * whole directory.
 */
export async function GET(request: Request): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireRole(...LAB_READ_ROLES);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { searchParams } = new URL(request.url);
  const parsed = laboratoryListQuerySchema.safeParse({
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

  const filter: Record<string, unknown> = {
    ...scopeFilter(user, "_id"),
  };
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
      Laboratory.countDocuments(filter),
      Laboratory.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    return listResponse(docs.map(toLaboratoryDto), buildListMeta(page, limit, total));
  } catch (error) {
    logApiFailure("laboratories", error);
    return errorResponse(
      503,
      "Unable to load laboratories right now. Please try again.",
    );
  }
}

/**
 * POST /api/laboratories
 *
 * Creates a laboratory. SUPER_ADMIN and ADMIN only (laboratory creation is
 * never available to LAB_MANAGER - scoped accounts edit their own records,
 * they do not mint new ones). Duplicate business codes are rejected with 409
 * before the insert; the unique index is the final guard.
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

  const parsed = laboratoryCreateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  try {
    await connectToDatabase();

    const existing = await Laboratory.findOne({ code: parsed.data.code })
      .select("_id")
      .lean();
    if (existing) {
      return errorResponse(
        409,
        "A laboratory with this code already exists. Choose a different code.",
      );
    }

    const laboratory = await Laboratory.create({
      name: parsed.data.name,
      code: parsed.data.code,
      phone: parsed.data.phone ?? null,
      email: parsed.data.email ?? null,
      address: parsed.data.address ?? null,
      city: parsed.data.city ?? null,
      state: parsed.data.state ?? null,
      pincode: parsed.data.pincode ?? null,
      registrationNumber: parsed.data.registrationNumber ?? null,
      accreditation: parsed.data.accreditation ?? null,
      ...(parsed.data.bookingConfig
        ? { bookingConfig: parsed.data.bookingConfig }
        : {}),
      ...(parsed.data.homeCollectionConfig
        ? { homeCollectionConfig: parsed.data.homeCollectionConfig }
        : {}),
      isActive: true,
    });

    return itemResponse(toLaboratoryDto(laboratory.toObject()), 201);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return errorResponse(
        409,
        "A laboratory with this code already exists. Choose a different code.",
      );
    }
    logApiFailure("laboratories/create", error);
    return errorResponse(
      503,
      "Unable to create the laboratory right now. Please try again.",
    );
  }
}
