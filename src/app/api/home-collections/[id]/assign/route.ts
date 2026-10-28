import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireRole, scopeFilter } from "@/lib/auth";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import { toHomeCollectionDetailDto } from "@/lib/api/serializers";
import { connectToDatabase } from "@/lib/db";
import { appendCollectionEvent } from "@/lib/home-collection/events";
import { HomeCollection } from "@/models/HomeCollection";
import { User } from "@/models/User";
import { toFieldIssues } from "@/lib/validation/common";
import {
  homeCollectionAssignSchema,
  homeCollectionIdSchema,
} from "@/lib/validation/home-collection";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/home-collections/[id]/assign
 *
 * Assigns or reassigns a collector. Rules (all enforced server-side):
 * - restricted to SUPER_ADMIN / ADMIN / LAB_MANAGER (a COLLECTOR can never
 *   self-assign or assign others);
 * - the target user must exist, be active and hold the COLLECTOR role;
 * - the request always ends in ASSIGNED: a fresh assignment advances
 *   CONFIRMED → ASSIGNED, and a reassignment after COLLECTOR_ACCEPTED
 *   returns it to ASSIGNED and clears the previous collector's acceptance
 *   (`collectorAcceptedAt`), so the newly assigned collector must accept it
 *   themselves instead of inheriting the old acceptance;
 * - the update is conditional on the status read above, so concurrent
 *   conflicting requests produce exactly one winner (409 otherwise);
 * - an audit event records who was assigned or reassigned.
 * - LAB_MANAGER may only assign on requests from their assigned
 *   laboratories (out-of-scope requests answer 404 before any write).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireRole(
      ROLES.SUPER_ADMIN,
      ROLES.ADMIN,
      ROLES.LAB_MANAGER,
    );
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { id } = await params;
  const parsedId = homeCollectionIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid collection id.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = homeCollectionAssignSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  try {
    await connectToDatabase();

    const collector = await User.findById(parsed.data.collectorId)
      .select("name phone role isActive")
      .lean();
    if (!collector || !collector.isActive || collector.role !== ROLES.COLLECTOR) {
      return errorResponse(
        400,
        "The selected collector was not found or is not active.",
        [{ field: "collectorId", message: "Select an active collector account." }],
      );
    }

    const collection = await HomeCollection.findOne({
      _id: parsedId.data.id,
      ...scopeFilter(user),
    })
      .select("status assignedCollectorId")
      .lean();
    if (!collection) {
      return errorResponse(404, "Collection request not found.");
    }

    const isReassign =
      collection.status === "ASSIGNED" ||
      collection.status === "COLLECTOR_ACCEPTED";
    const canAssignNow = collection.status === "CONFIRMED" || isReassign;
    if (!canAssignNow) {
      return errorResponse(
        409,
        "Collectors can only be assigned to confirmed or already assigned requests.",
      );
    }

    if (
      isReassign &&
      collection.assignedCollectorId !== null &&
      String(collection.assignedCollectorId) === parsed.data.collectorId
    ) {
      return errorResponse(
        409,
        "This collector is already assigned to the request.",
      );
    }

    const previousStatus = collection.status;

    // Conditional on the status read above: only one concurrent request wins.
    const updated = await HomeCollection.findOneAndUpdate(
      {
        _id: parsedId.data.id,
        status: collection.status,
      },
      {
        $set: {
          // ASSIGNED in every reachable case: fresh assign advances
          // CONFIRMED -> ASSIGNED, reassign at ASSIGNED stays there, and
          // reassign at COLLECTOR_ACCEPTED returns the request so the new
          // collector must accept it themselves.
          status: "ASSIGNED",
          assignedCollectorId: parsed.data.collectorId,
          assignedAt: new Date(),
          // Never let the previous collector's acceptance survive a swap.
          collectorAcceptedAt: null,
        },
      },
      { new: true, runValidators: true },
    )
      .populate("laboratoryId", "name code isActive")
      .populate("assignedCollectorId", "name phone")
      .lean();

    if (!updated) {
      return errorResponse(
        409,
        "The request changed before this assignment could be applied. Refresh and try again.",
      );
    }

    await appendCollectionEvent({
      collectionId: String(collection._id),
      eventType: isReassign ? "COLLECTOR_REASSIGNED" : "COLLECTOR_ASSIGNED",
      previousStatus,
      newStatus: "ASSIGNED",
      actorId: user.id,
      metadata: { collectorId: parsed.data.collectorId },
    });

    return itemResponse(
      toHomeCollectionDetailDto(updated, {
        canCancel: false,
        canAssign: true,
        canConfirm: false,
        canReject: false,
        canAdvanceStatus: true,
        canRecordFailure: true,
        canRecordCollected: true,
      }),
    );
  } catch (error) {
    logApiFailure("home-collections/[id]/assign", error);
    return errorResponse(
      503,
      "Unable to assign a collector right now. Please try again.",
    );
  }
}
