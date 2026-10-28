import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireRole } from "@/lib/auth";
import {
  buildListMeta,
  errorResponse,
  listResponse,
  logApiFailure,
} from "@/lib/api/response";
import { toCollectorOptionDto } from "@/lib/api/serializers";
import { connectToDatabase } from "@/lib/db";
import { User } from "@/models/User";
import { containsRegex, toFieldIssues } from "@/lib/validation/common";
import { homeCollectionCollectorsQuerySchema } from "@/lib/validation/home-collection";

export const dynamic = "force-dynamic";

/**
 * GET /api/home-collections/collectors
 *
 * Minimal directory of active COLLECTOR accounts for the assignment picker.
 * Restricted to the roles that may assign collectors; only id, name and
 * phone are returned - never email, credentials or unrelated profile data.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireRole(
      ROLES.SUPER_ADMIN,
      ROLES.ADMIN,
      ROLES.LAB_MANAGER,
    );
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { searchParams } = new URL(request.url);
  const parsed = homeCollectionCollectorsQuerySchema.safeParse({
    search: searchParams.get("search") ?? undefined,
  });

  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your search parameters and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const filter: Record<string, unknown> = {
    role: ROLES.COLLECTOR,
    isActive: true,
  };
  if (parsed.data.search) {
    filter.name = containsRegex(parsed.data.search);
  }

  try {
    await connectToDatabase();

    const docs = await User.find(filter)
      .select("name phone")
      .sort({ name: 1 })
      .limit(100)
      .lean();

    const data = docs.map(toCollectorOptionDto);
    return listResponse(data, buildListMeta(1, 100, data.length));
  } catch (error) {
    logApiFailure("home-collections/collectors", error);
    return errorResponse(
      503,
      "Unable to load collectors right now. Please try again.",
    );
  }
}
