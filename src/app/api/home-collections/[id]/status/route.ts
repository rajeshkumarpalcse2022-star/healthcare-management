import { NextResponse } from "next/server";

import { canTransitionCollectionStatus } from "@/config/home-collection";
import { ROLES } from "@/config/roles";
import { authErrorResponse, requireAuth, scopeFilter } from "@/lib/auth";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import { toHomeCollectionDetailDto } from "@/lib/api/serializers";
import { connectToDatabase } from "@/lib/db";
import {
  asCollectionStatus,
  canActOnAssignedCollection,
} from "@/lib/home-collection/authorization";
import { appendCollectionEvent } from "@/lib/home-collection/events";
import { releaseCollectionSlotQuietly } from "@/lib/home-collection/slots";
import { HomeCollection } from "@/models/HomeCollection";
import { Laboratory } from "@/models/Laboratory";
import { LabTest } from "@/models/LabTest";
import {
  generateSlotStarts,
  zonedWallClockToDate,
} from "@/lib/utils/booking-time";
import type { CollectionEventType } from "@/config/home-collection";
import { toFieldIssues } from "@/lib/validation/common";
import {
  homeCollectionIdSchema,
  homeCollectionStatusSchema,
} from "@/lib/validation/home-collection";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/** Which audit event each recorded transition produces. */
function eventTypeFor(target: string): CollectionEventType {
  switch (target) {
    case "CONFIRMED":
      return "REQUEST_CONFIRMED";
    case "REJECTED":
      return "REQUEST_REJECTED";
    case "COLLECTOR_ACCEPTED":
      return "COLLECTOR_ACCEPTED";
    case "FAILED":
      return "COLLECTION_FAILED";
    case "COLLECTED":
      return "COLLECTION_COMPLETED";
    default:
      return "STATUS_CHANGED";
  }
}

/**
 * PATCH /api/home-collections/[id]/status
 *
 * Records a lifecycle transition (confirm, advance pickup, complete, fail).
 * Rules (all enforced server-side, never trusted from the client):
 * - operational roles (SUPER_ADMIN / ADMIN / LAB_MANAGER) may confirm from
 *   PENDING and advance along the central transition map; a COLLECTOR may
 *   only act on requests assigned to them and only from an actionable status;
 * - `CANCELLED` / `COLLECTED` are rejected at schema level - cancellation has
 *   its own endpoint and completion requires OTP verification;
 * - FAILED requires a reason (schema-level refine);
 * - the update is conditional on the status read a moment earlier, so two
 *   concurrent writers produce exactly one winner and the loser receives 409
 *   (no double events, no double capacity release);
 * - a FAILED outcome releases the reserved slot capacity (FAILED is not a
 *   capacity-holding status); COLLECTED keeps it (the visit was consumed);
 * - an audit event is appended with the verified actor.
 * - LAB_MANAGER transitions are limited to requests from their assigned
 *   laboratories (the scope is folded into the lookup, so out-of-scope
 *   requests answer 404 before any write; collectors are unaffected).
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = homeCollectionStatusSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check the status update and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const target = parsed.data.status;
  const failureReason = parsed.data.failureReason ?? null;

  try {
    await connectToDatabase();

    const collection = await HomeCollection.findOne({
      _id: parsedId.data.id,
      ...scopeFilter(user),
    })
      .select(
        "status patientId assignedCollectorId laboratoryId scheduledDate timeSlot timezone activeBookingLinkKey items",
      )
      .lean();
    if (!collection) {
      return errorResponse(404, "Collection request not found.");
    }

    const isOps = user.role === ROLES.SUPER_ADMIN ||
      user.role === ROLES.ADMIN ||
      user.role === ROLES.LAB_MANAGER;
    const isAssigned = canActOnAssignedCollection(user, collection);
    if (!isOps && !isAssigned) {
      // 404 (not 403): no existence probing, same as the detail route.
      return errorResponse(404, "Collection request not found.");
    }

    // CANCELLED and COLLECTED are absent from homeCollectionStatusSchema's
    // enum, so they can never reach this endpoint: cancellation has its own
    // action and completion requires OTP verification.

    const current = asCollectionStatus(collection.status);
    if (!current) {
      return errorResponse(409, "The collection has an unknown status.");
    }

    if (current === target) {
      return errorResponse(
        409,
        "The collection request is already in that status.",
      );
    }

    if (!canTransitionCollectionStatus(current, target)) {
      return errorResponse(
        409,
        `A collection cannot move from ${current} to ${target}.`,
      );
    }

    /* ------------- approval: re-verify the request end to end ------------- */
    if (target === "CONFIRMED") {
      const laboratory = await Laboratory.findById(collection.laboratoryId)
        .select("name isActive homeCollectionConfig")
        .lean();
      if (!laboratory) {
        return errorResponse(
          404,
          "The laboratory for this request was not found.",
        );
      }
      if (!laboratory.isActive) {
        return errorResponse(
          409,
          "This laboratory is no longer accepting collection requests, so the request cannot be approved.",
        );
      }

      const scheduleConfig = laboratory.homeCollectionConfig;
      if (!scheduleConfig) {
        return errorResponse(
          409,
          "This laboratory no longer offers home sample collection, so the request cannot be approved.",
        );
      }

      const validStarts = generateSlotStarts(
        scheduleConfig.openingTime,
        scheduleConfig.closingTime,
        scheduleConfig.slotDurationMinutes,
      );
      if (!validStarts.includes(collection.timeSlot)) {
        return errorResponse(
          409,
          "The requested time slot is no longer offered by this laboratory.",
        );
      }

      const startAt = zonedWallClockToDate(
        collection.scheduledDate.toISOString().slice(0, 10),
        collection.timeSlot,
        collection.timezone || scheduleConfig.timezone,
      );
      if (!startAt || startAt.getTime() <= Date.now()) {
        return errorResponse(
          409,
          "The collection slot has already passed. Reject the request instead.",
        );
      }

      const testIds = collection.items.map((item) => item.labTestId);
      const tests = await LabTest.find({ _id: { $in: testIds } })
        .select("laboratoryId name code isActive homeCollectionEnabled")
        .lean();
      if (tests.length !== testIds.length) {
        return errorResponse(
          409,
          "One or more selected tests no longer exist, so the request cannot be approved.",
        );
      }
      for (const test of tests) {
        if (String(test.laboratoryId) !== String(collection.laboratoryId)) {
          return errorResponse(
            409,
            "A selected test no longer belongs to this laboratory.",
          );
        }
        if (!test.isActive) {
          return errorResponse(
            409,
            `${test.name} is no longer offered, so the request cannot be approved.`,
          );
        }
        if (test.homeCollectionEnabled === false) {
          return errorResponse(
            409,
            `${test.name} is no longer available for home collection. Reject the request and ask the patient to re-request.`,
          );
        }
      }
    }

    const update: Record<string, unknown> = { status: target };
    if (target === "FAILED" && failureReason) {
      update.failureReason = failureReason;
      update.failedAt = new Date();
      // FAILED is not a capacity-holding status: release the reserved slot.
      update.activeBookingLinkKey = null;
    }
    if (target === "CONFIRMED") {
      update.reviewedBy = user.id;
      update.reviewedAt = new Date();
    }
    if (target === "COLLECTOR_ACCEPTED") {
      update.collectorAcceptedAt = new Date();
    }
    if (target === "COLLECTOR_EN_ROUTE") {
      update.enRouteAt = new Date();
    }
    if (target === "ARRIVED") {
      update.arrivedAt = new Date();
    }
    // COLLECTED is intentionally absent: completion happens only through the
    // OTP verification endpoint, which atomically consumes the OTP hash.

    // Conditional flip: only one concurrent writer wins this update.
    const updated = await HomeCollection.findOneAndUpdate(
      { _id: parsedId.data.id, status: current },
      { $set: update },
      { new: true, runValidators: true },
    )
      .populate("laboratoryId", "name code isActive")
      .populate("assignedCollectorId", "name phone")
      .lean();

    if (!updated) {
      return errorResponse(
        409,
        "The request changed before this update could be applied. Refresh and try again.",
      );
    }

    await appendCollectionEvent({
      collectionId: String(collection._id),
      eventType: eventTypeFor(target),
      previousStatus: current,
      newStatus: target,
      actorId: user.id,
      metadata: failureReason ? { hasReason: true } : null,
    });

    if (target === "FAILED") {
      await releaseCollectionSlotQuietly({
        laboratoryId: String(collection.laboratoryId),
        date: collection.scheduledDate.toISOString().slice(0, 10),
        timeSlot: collection.timeSlot,
      });
    }

    const canWriteOps = isOps;
    return itemResponse(
      toHomeCollectionDetailDto(updated, {
        canCancel: false,
        canAssign: false,
        canConfirm: false,
        canReject: false,
        canAdvanceStatus: canWriteOps && target !== "FAILED",
        canRecordFailure: canWriteOps && target !== "FAILED",
        // COLLECTED is only reachable via the OTP verification endpoint.
        canRecordCollected: false,
      }),
    );
  } catch (error) {
    logApiFailure("home-collections/[id]/status", error);
    return errorResponse(
      503,
      "Unable to update the collection status right now. Please try again.",
    );
  }
}
