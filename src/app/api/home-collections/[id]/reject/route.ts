import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import {
  authErrorResponse,
  requireAuth,
  scopeFilter,
} from "@/lib/auth";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import { toHomeCollectionDetailDto } from "@/lib/api/serializers";
import { connectToDatabase } from "@/lib/db";
import { canViewCollectionManagement } from "@/lib/home-collection/authorization";
import { appendCollectionEvent } from "@/lib/home-collection/events";
import { releaseCollectionSlotQuietly } from "@/lib/home-collection/slots";
import { HomeCollection } from "@/models/HomeCollection";
import { toFieldIssues } from "@/lib/validation/common";
import {
  homeCollectionIdSchema,
  homeCollectionRejectSchema,
} from "@/lib/validation/home-collection";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/home-collections/[id]/reject
 *
 * Lab-manager review action: rejects a PENDING request with a mandatory
 * reason. Rules (all enforced server-side):
 * - only SUPER_ADMIN / ADMIN / LAB_MANAGER may reject (write/assign roles);
 * - only a PENDING request may be rejected - once assigned or later the
 *   workflow has moved on and cancellation covers the operational case;
 * - the reason is required (schema-level refine) and stored on the record
 *   for the patient timeline;
 * - the flip is a conditional update so concurrent reviewers produce exactly
 *   one winner; the loser receives 409;
 * - REJECTED is not a capacity-holding status: the reserved slot is released
 *   and the booking link guard is cleared so the patient may re-request.
 * - LAB_MANAGER may only reject requests from their assigned laboratories
 *   (out-of-scope requests answer 404 before any write).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireAuth();
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const isReviewer =
    user.role === ROLES.SUPER_ADMIN ||
    user.role === ROLES.ADMIN ||
    user.role === ROLES.LAB_MANAGER;
  if (!isReviewer || !canViewCollectionManagement(user.role)) {
    return errorResponse(403, "You do not have permission to review requests.");
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

  const parsed = homeCollectionRejectSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "A rejection reason is required.",
      toFieldIssues(parsed.error),
    );
  }

  try {
    await connectToDatabase();

    const collection = await HomeCollection.findOne({
      _id: parsedId.data.id,
      ...scopeFilter(user),
    }).lean();
    if (!collection) {
      return errorResponse(404, "Collection request not found.");
    }

    if (collection.status !== "PENDING") {
      return errorResponse(
        409,
        "Only pending requests can be rejected. Refresh and try again.",
      );
    }

    const dateString = collection.scheduledDate.toISOString().slice(0, 10);

    // Conditional flip: only one concurrent reviewer wins this update.
    const rejected = await HomeCollection.findOneAndUpdate(
      { _id: parsedId.data.id, status: "PENDING" },
      {
        $set: {
          status: "REJECTED",
          rejectionReason: parsed.data.reason,
          reviewedBy: user.id,
          reviewedAt: new Date(),
          activeBookingLinkKey: null,
        },
      },
      { new: true, runValidators: true },
    )
      .populate("laboratoryId", "name code isActive")
      .populate("assignedCollectorId", "name phone")
      .lean();

    if (!rejected) {
      return errorResponse(
        409,
        "This request was already reviewed. Refresh and try again.",
      );
    }

    await appendCollectionEvent({
      collectionId: String(collection._id),
      eventType: "REQUEST_REJECTED",
      previousStatus: "PENDING",
      newStatus: "REJECTED",
      actorId: user.id,
      metadata: { reason: parsed.data.reason.slice(0, 500) },
    });

    // REJECTED is not a capacity-holding status: release the reserved slot.
    await releaseCollectionSlotQuietly({
      laboratoryId: String(collection.laboratoryId),
      date: dateString,
      timeSlot: collection.timeSlot,
    });

    return itemResponse(
      toHomeCollectionDetailDto(rejected, {
        canCancel: false,
        canAssign: false,
        canConfirm: false,
        canReject: false,
        canAdvanceStatus: false,
        canRecordFailure: false,
        canRecordCollected: false,
      }),
    );
  } catch (error) {
    logApiFailure("home-collections/[id]/reject", error);
    return errorResponse(
      503,
      "Unable to reject the collection request right now. Please try again.",
    );
  }
}
