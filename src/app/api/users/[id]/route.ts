import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import {
  SCOPED_ROLES,
  authErrorResponse,
  requireRole,
  toSafeUser,
} from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import {
  errorResponse,
  isDuplicateKeyError,
  itemResponse,
  logApiFailure,
} from "@/lib/api/response";
import { User } from "@/models/User";
import { objectIdSchema, toFieldIssues } from "@/lib/validation/common";
import { userPatchSchema } from "@/lib/validation/user-scope";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/users/[id]
 *
 * Partial account update (SUPER_ADMIN / ADMIN only). Rules:
 * - self-mutation is rejected (400) so an administrator can never disable,
 *   demote or re-key their own account;
 * - SUPER_ADMIN accounts are only editable by a SUPER_ADMIN actor, and the
 *   role enum is provisionable-roles-only, so this endpoint can never grant
 *   SUPER_ADMIN;
 * - an email change is uniqueness-checked (409 on conflict);
 * - promoting an account to LAB_MANAGER/STAFF that has no stored scope yet
 *   writes an explicit empty `laboratoryIds` (fail-closed) so the account
 *   sees nothing until laboratories are assigned;
 * - omitted keys leave the stored values unchanged; an empty body is a 400.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let actor: SafeUser;
  try {
    actor = await requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { id } = await params;
  const parsedId = objectIdSchema.safeParse(id);
  if (!parsedId.success) {
    return errorResponse(400, "Invalid user id.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = userPatchSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check the account details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const updates = parsed.data;

  try {
    await connectToDatabase();

    const user = await User.findById(parsedId.data).lean();
    if (!user) {
      return errorResponse(404, "User not found.");
    }

    if (parsedId.data === actor.id) {
      return errorResponse(400, "You cannot edit your own account here.");
    }
    if (user.role === ROLES.SUPER_ADMIN && actor.role !== ROLES.SUPER_ADMIN) {
      return errorResponse(
        403,
        "Only a super admin can modify super admin accounts.",
      );
    }

    if (
      updates.email !== undefined &&
      updates.email !== user.email
    ) {
      const existing = await User.findOne({ email: updates.email })
        .select("_id")
        .lean();
      if (existing) {
        return errorResponse(409, "An account with this email already exists.");
      }
    }

    const $set: Record<string, unknown> = {};
    if (updates.name !== undefined && updates.name !== user.name) {
      $set.name = updates.name;
    }
    if (updates.email !== undefined && updates.email !== user.email) {
      $set.email = updates.email;
    }
    if (updates.phone !== undefined) {
      const nextPhone = updates.phone;
      const currentPhone = user.phone ?? null;
      if (nextPhone !== currentPhone) $set.phone = nextPhone;
    }
    if (updates.role !== undefined && updates.role !== user.role) {
      $set.role = updates.role;
    }
    if (updates.isActive !== undefined && updates.isActive !== user.isActive) {
      $set.isActive = updates.isActive;
    }

    // Fail-closed scope: an account promoted into a scoped operational role
    // with no stored scope yet is written as explicitly scoped-to-nothing,
    // never left absent (which would read as legacy platform-wide).
    if (
      $set.role !== undefined &&
      (SCOPED_ROLES as readonly string[]).includes(String($set.role)) &&
      !Array.isArray(user.laboratoryIds)
    ) {
      $set.laboratoryIds = [];
    }

    if (Object.keys($set).length === 0) {
      return itemResponse(toSafeUser(user));
    }

    const updated = await User.findByIdAndUpdate(
      parsedId.data,
      { $set },
      { new: true, runValidators: true },
    ).lean();

    if (!updated) {
      return errorResponse(404, "User not found.");
    }

    return itemResponse(toSafeUser(updated));
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return errorResponse(409, "An account with this email already exists.");
    }
    logApiFailure("users/[id]", error);
    return errorResponse(
      503,
      "Unable to update the account right now. Please try again.",
    );
  }
}
