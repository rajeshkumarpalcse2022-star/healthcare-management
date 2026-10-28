import { NextResponse } from "next/server";

import {
  COLLECTION_CANCELLATION_CUTOFF_HOURS,
  COLLECTION_CANCELLABLE_STATUSES,
} from "@/config/home-collection";
import { authErrorResponse, requireAuth } from "@/lib/auth";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import { toHomeCollectionDetailDto } from "@/lib/api/serializers";
import { connectToDatabase } from "@/lib/db";
import { canCancelCollection } from "@/lib/home-collection/authorization";
import { appendCollectionEvent } from "@/lib/home-collection/events";
import { releaseCollectionSlotQuietly } from "@/lib/home-collection/slots";
import { HomeCollection } from "@/models/HomeCollection";
import { toFieldIssues } from "@/lib/validation/common";
import {
  homeCollectionCancelSchema,
  homeCollectionIdSchema,
} from "@/lib/validation/home-collection";
import { cancellationDeadline } from "@/lib/utils/booking-time";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/home-collections/[id]/cancel
 *
 * Cancels an eligible request. Rules (all enforced server-side):
 * - only the owning patient or an operational cancel role may cancel;
 * - PENDING, CONFIRMED and ASSIGNED requests are cancellable; terminal
 *   states are not, so a cancelled request can never be cancelled twice;
 * - the configured cutoff must not have passed yet (laboratory timezone);
 * - the status flip is a single conditional update, so concurrent duplicate
 *   requests produce exactly one winner - the loser gets 409 and no second
 *   capacity release happens;
 * - a successful cancellation releases the reserved slot capacity, clears
 *   the booking link guard (so the booking may be re-linked later) and keeps
 *   the record (with reason and timestamp) for audit history.
 * - LAB_MANAGER/STAFF accounts only cancel requests from their assigned
 *   laboratories (out-of-scope requests answer 404 - scope enforced in
 *   `canCancelCollection`, no existence probing).
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

  const { id } = await params;
  const parsedId = homeCollectionIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid collection id.");
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const parsed = homeCollectionCancelSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  try {
    await connectToDatabase();

    const collection = await HomeCollection.findById(parsedId.data.id).lean();
    if (!collection || !canCancelCollection(user, collection)) {
      // Same 404 for "missing" and "not yours" - no existence probing.
      return errorResponse(404, "Collection request not found.");
    }

    if (collection.status === "CANCELLED") {
      return errorResponse(409, "This collection request has already been cancelled.");
    }
    if (!(COLLECTION_CANCELLABLE_STATUSES as readonly string[]).includes(collection.status)) {
      return errorResponse(
        409,
        "This collection request can no longer be cancelled.",
      );
    }

    const dateString = collection.scheduledDate.toISOString().slice(0, 10);
    const deadline = cancellationDeadline(
      dateString,
      collection.timeSlot,
      collection.timezone,
      COLLECTION_CANCELLATION_CUTOFF_HOURS,
    );
    if (deadline && Date.now() >= deadline.getTime()) {
      return errorResponse(
        409,
        `Collections can only be cancelled at least ${COLLECTION_CANCELLATION_CUTOFF_HOURS} hour(s) before the scheduled slot.`,
      );
    }

    const previousStatus = collection.status;

    // Conditional flip: only one concurrent request can win this update.
    const cancelled = await HomeCollection.findOneAndUpdate(
      {
        _id: parsedId.data.id,
        status: { $in: [...COLLECTION_CANCELLABLE_STATUSES] },
      },
      {
        $set: {
          status: "CANCELLED",
          cancellationReason: parsed.data.reason ?? null,
          cancelledAt: new Date(),
          assignedCollectorId: null,
          activeBookingLinkKey: null,
        },
      },
      { new: true, runValidators: true },
    )
      .populate("laboratoryId", "name code isActive")
      .populate("assignedCollectorId", "name phone")
      .lean();

    if (!cancelled) {
      return errorResponse(
        409,
        "This collection request can no longer be cancelled.",
      );
    }

    await appendCollectionEvent({
      collectionId: String(collection._id),
      eventType: "REQUEST_CANCELLED",
      previousStatus,
      newStatus: "CANCELLED",
      actorId: user.id,
      metadata: parsed.data.reason ? { hasReason: true } : null,
    });

    // Release the reserved capacity only after the successful transition.
    await releaseCollectionSlotQuietly({
      laboratoryId: String(collection.laboratoryId),
      date: dateString,
      timeSlot: collection.timeSlot,
    });

    return itemResponse(toHomeCollectionDetailDto(cancelled, {
      canCancel: false,
      canAssign: false,
      canConfirm: false,
      canReject: false,
      canAdvanceStatus: false,
      canRecordFailure: false,
      canRecordCollected: false,
    }));
  } catch (error) {
    logApiFailure("home-collections/[id]/cancel", error);
    return errorResponse(
      503,
      "Unable to cancel the collection request right now. Please try again.",
    );
  }
}
