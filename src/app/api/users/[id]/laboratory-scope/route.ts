import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { SCOPED_ROLES } from "@/lib/auth/laboratory-scope";
import { authErrorResponse, requireRole, toSafeUser } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import { Laboratory } from "@/models/Laboratory";
import { User } from "@/models/User";
import { objectIdSchema, toFieldIssues } from "@/lib/validation/common";
import {
  SCOPE_HISTORY_CAP,
  userScopeUpdateSchema,
} from "@/lib/validation/user-scope";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/** Order-insensitive comparison: a reordered selection is not a change. */
function sameIdSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

/**
 * PATCH /api/users/[id]/laboratory-scope
 *
 * Sets the COMPLETE laboratory scope for one LAB_MANAGER/STAFF account
 * (SUPER_ADMIN / ADMIN only - D3). Rules:
 * - the body is the full replacement set, not a delta: `[]` explicitly
 *   scopes the account to no laboratory; an unchanged (reordered or
 *   identical) set records no audit entry;
 * - only LAB_MANAGER / STAFF accounts can carry a scope at all - other
 *   roles answer 400, because a scope on them would be silently ignored by
 *   `resolveLaboratoryScope` and is rejected instead of being stored dead;
 * - every referenced laboratory must exist (400 otherwise);
 * - every real change appends an embedded audit entry (who, when, previous
 *   and new set) to `laboratoryScopeHistory`, capped at the newest
 *   `SCOPE_HISTORY_CAP` entries so the embedded trail stays bounded;
 * - the scope field IS the record: a legacy account (field absent) stays
 *   platform-wide until this endpoint explicitly writes it.
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

  const parsed = userScopeUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check the laboratory assignment and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const nextIds = parsed.data.laboratoryIds;

  try {
    await connectToDatabase();

    const user = await User.findById(parsedId.data).lean();
    if (!user) {
      return errorResponse(404, "User not found.");
    }
    if (!(SCOPED_ROLES as readonly string[]).includes(user.role)) {
      return errorResponse(
        400,
        "Laboratory scope only applies to lab manager and staff accounts.",
      );
    }

    if (nextIds.length > 0) {
      const existing = await Laboratory.countDocuments({
        _id: { $in: nextIds },
      });
      if (existing !== nextIds.length) {
        return errorResponse(
          400,
          "One or more selected laboratories no longer exist. Refresh the list and try again.",
        );
      }
    }

    const previousIds = Array.isArray(user.laboratoryIds)
      ? [...user.laboratoryIds]
      : null;
    // A stored `null` (legacy absent) is always a change: platform-wide to
    // an explicit set is exactly what this endpoint exists to record.
    if (previousIds !== null && sameIdSet(previousIds, nextIds)) {
      return itemResponse(toSafeUser(user));
    }

    const updated = await User.findByIdAndUpdate(
      parsedId.data,
      {
        $set: { laboratoryIds: nextIds },
        $push: {
          laboratoryScopeHistory: {
            $each: [
              {
                laboratoryIds: nextIds,
                previousLaboratoryIds: previousIds ?? [],
                changedBy: actor.id,
                changedAt: new Date(),
              },
            ],
            $slice: -SCOPE_HISTORY_CAP,
          },
        },
      },
      { new: true, runValidators: true },
    ).lean();

    if (!updated) {
      return errorResponse(404, "User not found.");
    }

    return itemResponse(toSafeUser(updated));
  } catch (error) {
    logApiFailure("users/laboratory-scope", error);
    return errorResponse(
      503,
      "Unable to update the laboratory scope right now. Please try again.",
    );
  }
}
