import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import {
  authErrorResponse,
  hashPassword,
  requireRole,
  SCOPED_ROLES,
  toSafeUser,
} from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import {
  buildListMeta,
  errorResponse,
  isDuplicateKeyError,
  itemResponse,
  listResponse,
  logApiFailure,
} from "@/lib/api/response";
import { User } from "@/models/User";
import {
  containsRegex,
  toFieldIssues,
} from "@/lib/validation/common";
import {
  userListQuerySchema,
  userCreateSchema,
} from "@/lib/validation/user-scope";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/users
 *
 * Paginated user directory backing the laboratory-assignment admin surface.
 * SUPER_ADMIN / ADMIN only (D3) - operational roles never receive a list of
 * platform accounts. Rows are the credential-free `SafeUser` shape (including
 * `laboratoryIds` when the account carries one); `passwordHash` never leaves
 * the server. Server-side search covers name and email; `role` optionally
 * narrows to one exact role.
 */
export async function GET(request: Request): Promise<NextResponse> {
  try {
    await requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { searchParams } = new URL(request.url);
  const parsed = userListQuerySchema.safeParse({
    search: searchParams.get("search") ?? undefined,
    role: searchParams.get("role") ?? undefined,
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

  const { search, role, page, limit } = parsed.data;

  const filter: Record<string, unknown> = {};
  if (role) filter.role = role;
  if (search) {
    filter.$or = [
      { name: containsRegex(search) },
      { email: containsRegex(search) },
    ];
  }

  try {
    await connectToDatabase();

    const [total, docs] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const rows: SafeUser[] = docs.map(toSafeUser);
    return listResponse(rows, buildListMeta(page, limit, total));
  } catch (error) {
    logApiFailure("users", error);
    return errorResponse(
      503,
      "Unable to load users right now. Please try again.",
    );
  }
}

/**
 * POST /api/users
 *
 * Creates a privileged account (SUPER_ADMIN / ADMIN only). The accepted
 * roles are exactly `PROVISIONABLE_ROLES` - PATIENT self-registers through
 * the public registration endpoint and SUPER_ADMIN stays seed-only, so this
 * endpoint can never be used to mint a platform owner. The password is
 * bcrypt-hashed before storage; no session is issued (the new user signs in
 * separately). New LAB_MANAGER/STAFF accounts get an explicit empty
 * `laboratoryIds` (scoped to nothing) so they are fail-closed until an
 * administrator assigns laboratories through the Staff Access surface.
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

  const parsed = userCreateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check the account details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const { name, password, role } = parsed.data;
  const email = parsed.data.email;
  const phone = parsed.data.phone ?? null;

  try {
    await connectToDatabase();

    const existing = await User.findOne({ email }).select("_id").lean();
    if (existing) {
      return errorResponse(409, "An account with this email already exists.");
    }

    const passwordHash = await hashPassword(password);

    const user = await User.create({
      name,
      email,
      phone,
      passwordHash,
      role,
      isActive: true,
      // Scoped operational roles start fail-closed: explicit [] (scoped to
      // no laboratory) rather than the absent field (legacy platform-wide).
      ...((SCOPED_ROLES as readonly string[]).includes(role)
        ? { laboratoryIds: [] }
        : {}),
    });

    return itemResponse(toSafeUser(user), 201);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return errorResponse(409, "An account with this email already exists.");
    }
    logApiFailure("users/create", error);
    return errorResponse(
      503,
      "Unable to create the account right now. Please try again.",
    );
  }
}
