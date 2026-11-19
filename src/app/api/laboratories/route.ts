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
  listResponse,
  logApiFailure,
  NO_STORE,
} from "@/lib/api/response";
import { toLaboratoryDto } from "@/lib/api/serializers";
import { provisionAccount } from "@/lib/provisioning";
import { Laboratory } from "@/models/Laboratory";
import { User } from "@/models/User";
import {
  laboratoryCreateSchema,
  laboratoryListQuerySchema,
} from "@/lib/validation/laboratory";
import {
  containsRegex,
  statusToBoolean,
  toFieldIssues,
} from "@/lib/validation/common";
import type { ItemResponse } from "@/types/api";
import type { Laboratory as LaboratoryDto } from "@/types/laboratory";
import type { ProvisionedCredentials } from "@/types/auth";

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
 * Creates a laboratory AND a LAB_MANAGER login account in the same
 * operation. The User account receives a generated unique ID (`LAB-XXXXX`)
 * and a temporary password; the credentials are returned exactly once in the
 * response so the administrator can hand them to the laboratory.
 * SUPER_ADMIN and ADMIN only.
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

    // A login email is required to mint the LAB_MANAGER account.
    const loginEmail = parsed.data.email?.trim();
    if (!loginEmail) {
      return errorResponse(
        400,
        "An email address is required - it becomes the laboratory login email.",
        [{ field: "email", message: "Email is required for the lab account." }],
      );
    }

    const existingUser = await User.findOne({ email: loginEmail })
      .select("_id")
      .lean();
    if (existingUser) {
      return errorResponse(
        409,
        "A user with this email already exists. Use a different email.",
        [{ field: "email", message: "This email is already in use." }],
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

    const provisioned = await provisionAccount({
      name: `${parsed.data.name} (Lab Manager)`,
      email: loginEmail,
      phone: parsed.data.phone ?? null,
      role: "LAB_MANAGER",
    });

    // Scope the new LAB_MANAGER to just this laboratory (fail-closed default
    // is []; give them their own lab so the dashboard is immediately usable).
    await User.updateOne(
      { _id: provisioned.user.id },
      { $set: { laboratoryIds: [String(laboratory._id)] } },
    );

    const credentials: ProvisionedCredentials = {
      uniqueId: provisioned.user.uniqueId ?? "",
      password: provisioned.plainPassword,
    };

    return NextResponse.json<
      ItemResponse<LaboratoryDto> & { credentials?: ProvisionedCredentials }
    >(
      {
        success: true,
        data: toLaboratoryDto(laboratory.toObject()),
        credentials,
      },
      { status: 201, headers: NO_STORE },
    );
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
