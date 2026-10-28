import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import {
  canAssignCollectors,
  canWriteCollectionStatus,
  COLLECTION_CANCELLABLE_STATUSES,
  canTransitionCollectionStatus,
} from "@/config/home-collection";
import { authErrorResponse, requireAuth } from "@/lib/auth";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import {
  toHomeCollectionDetailDto,
  toHomeCollectionEventDto,
  type CollectionViewerCapabilities,
} from "@/lib/api/serializers";
import { connectToDatabase } from "@/lib/db";
import {
  asCollectionStatus,
  canViewCollection,
} from "@/lib/home-collection/authorization";
import { HomeCollection } from "@/models/HomeCollection";
import { HomeCollectionEvent } from "@/models/HomeCollectionEvent";
import { homeCollectionIdSchema } from "@/lib/validation/home-collection";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/home-collections/[id]
 *
 * Collection detail for the current user only:
 * - the owning patient sees their own request;
 * - the assigned collector sees their assigned pickup (including the address
 *   and phone needed to perform it);
 * - operational roles see any request.
 * Anyone else receives 404 (not 403) so collection references cannot be
 * probed for existence - and a collector changing the URL id cannot reach
 * another collector's assignment. LAB_MANAGER/STAFF accounts with
 * assignments receive the same 404 for requests from laboratories outside
 * their scope (scope enforced in `canViewCollection`). Private responses
 * carry `Cache-Control: no-store` via the shared envelope.
 */
export async function GET(
  _request: Request,
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

  try {
    await connectToDatabase();

    const collection = await HomeCollection.findById(parsedId.data.id)
      .select(
        "+otpExpiresAt +otpAttempts +otpMaxAttempts +otpVerifiedAt",
      )
      .populate("laboratoryId", "name code isActive")
      .populate("patientId", "name")
      .populate("assignedCollectorId", "name phone")
      .populate("labBookingId", "bookingCode status")
      .populate("retryOfId", "collectionCode")
      .lean();

    if (!collection || !canViewCollection(user, collection)) {
      return errorResponse(404, "Collection request not found.");
    }

    const status = asCollectionStatus(collection.status);
    const isOps = canWriteCollectionStatus(user.role);

    const refId = (raw: unknown): string | null => {
      if (raw === null || raw === undefined) return null;
      if (typeof raw === "object" && "_id" in raw) {
        return String((raw as { _id: unknown })._id);
      }
      return String(raw);
    };

    const isOwner =
      user.role === ROLES.PATIENT && refId(collection.patientId) === user.id;
    const isAssignedCollector =
      user.role === ROLES.COLLECTOR &&
      refId(collection.assignedCollectorId) === user.id;

    const capabilities: CollectionViewerCapabilities = {
      canCancel:
        (isOps || isOwner) &&
        status !== null &&
        (COLLECTION_CANCELLABLE_STATUSES as readonly string[]).includes(status),
      canAssign:
        canAssignCollectors(user.role) &&
        status !== null &&
        (status === "CONFIRMED" || status === "ASSIGNED" || status === "COLLECTOR_ACCEPTED"),
      canConfirm: isOps && status === "PENDING",
      canReject: isOps && status === "PENDING",
      canAdvanceStatus:
        (isOps || isAssignedCollector) &&
        status !== null &&
        status !== "PENDING" &&
        status !== "REJECTED" &&
        status !== "CANCELLED" &&
        status !== "FAILED" &&
        status !== "COLLECTED",
      canRecordFailure:
        (isOps || isAssignedCollector) &&
        status !== null &&
        canTransitionCollectionStatus(status, "FAILED"),
      // Always false: collection completion is only reachable through the
      // OTP verification endpoint, never a generic status update.
      canRecordCollected: false,
    };

    // Audit timeline is only meaningful to operational viewers and the owner.
    const detail = toHomeCollectionDetailDto(collection, capabilities);
    if (isOps || isOwner) {
      const events = await HomeCollectionEvent.find({
        collectionId: collection._id,
      })
        .sort({ createdAt: -1 })
        .limit(50)
        .populate("actorId", "name")
        .lean();
      detail.history = events.map(toHomeCollectionEventDto);
    }

    return itemResponse(detail);
  } catch (error) {
    logApiFailure("home-collections/[id]", error);
    return errorResponse(
      503,
      "Unable to load the collection request right now. Please try again.",
    );
  }
}
