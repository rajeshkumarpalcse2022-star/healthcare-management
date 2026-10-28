import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireAuth, scopeFilter } from "@/lib/auth";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import { toHomeCollectionDetailDto } from "@/lib/api/serializers";
import { connectToDatabase } from "@/lib/db";
import { canActOnAssignedCollection } from "@/lib/home-collection/authorization";
import { appendCollectionEvent } from "@/lib/home-collection/events";
import { verifyCollectionOtp } from "@/lib/home-collection/otp";
import { HomeCollection } from "@/models/HomeCollection";
import { toFieldIssues } from "@/lib/validation/common";
import {
  homeCollectionIdSchema,
  homeCollectionVerifyOtpSchema,
} from "@/lib/validation/home-collection";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/** Statuses from which a collector may still verify the OTP and complete. */
const OTP_VERIFIABLE_STATUSES = [
  "COLLECTOR_ACCEPTED",
  "COLLECTOR_EN_ROUTE",
  "ARRIVED",
] as const;

/** Wrong-attempt error messages (deliberately vague on remaining count). */
const INVALID_OTP_MESSAGE = "Incorrect OTP. Ask the patient to re-read the code.";
const OTP_EXPIRED_MESSAGE = "This OTP has expired. Ask the patient to generate a new one.";
const OTP_LOCKED_MESSAGE = "Too many incorrect attempts. Ask the patient to generate a new OTP.";

/**
 * POST /api/home-collections/[id]/verify-otp
 *
 * Collector OTP verification. The patient verbally shares the 6-digit OTP
 * shown once at request creation; the collector submits it here to complete
 * the pickup. Rules (all enforced server-side, never trusted from the client):
 * - only the assigned collector (or ops roles for assisted completion) may
 *   call this; a different collector, the owning patient, or any other
 *   non-ops caller receives 404 (no existence probing);
 * - the assigned collector's authorization only covers actionable pickups:
 *   once the request is no longer COLLECTOR_ACCEPTED / COLLECTOR_EN_ROUTE /
 *   ARRIVED - including after completion, when status is COLLECTED - a
 *   collector caller receives 404, while ops roles pass the authorization
 *   gate and reach the status rule below (409);
 * - the request must be in COLLECTOR_ACCEPTED / COLLECTOR_EN_ROUTE / ARRIVED
 *   for ops roles, otherwise 409 "cannot be completed from its current
 *   status"; after completion the first status check answers this for every
 *   ops caller (the separate `otpVerifiedAt` 409 below covers the case where
 *   status and flag could diverge);
 * - OTP expiry and attempt lock are checked before the hash comparison;
 * - the comparison + COLLECTED flip is a SINGLE conditional update on the
 *   stored `otpHash`, so two concurrent submissions produce exactly one
 *   winner - the loser receives 409 and no double completion event;
 * - every failed attempt increments `otpAttempts`; when the limit is
 *   reached the OTP is locked (410) until a new request is created;
 * - a successful verification sets `otpVerifiedAt` and `collectedAt`, keeps
 *   slot capacity (the visit was consumed) and appends a completion event.
 */
export async function POST(
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

  const parsed = homeCollectionVerifyOtpSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Enter the 6-digit OTP shown to the patient.",
      toFieldIssues(parsed.error),
    );
  }

  try {
    await connectToDatabase();

    // `otpHash` is select:false on the schema - opt in explicitly.
    // Scope is folded in: a LAB_MANAGER outside their assigned laboratories
    // gets 404 for requests belonging to other labs (no probing), while
    // in-scope requests keep the documented operational 409 semantics.
    const collection = await HomeCollection.findOne({
      _id: parsedId.data.id,
      ...scopeFilter(user),
    })
      .select(
        "status patientId assignedCollectorId laboratoryId otpHash otpExpiresAt otpAttempts otpMaxAttempts otpVerifiedAt",
      )
      .lean();
    if (!collection) {
      return errorResponse(404, "Collection request not found.");
    }

    const isOps =
      user.role === ROLES.SUPER_ADMIN ||
      user.role === ROLES.ADMIN ||
      user.role === ROLES.LAB_MANAGER;
    const isAssigned = canActOnAssignedCollection(user, collection);
    if (!isOps && !isAssigned) {
      return errorResponse(404, "Collection request not found.");
    }

    const status = collection.status as (typeof OTP_VERIFIABLE_STATUSES)[number];
    if (!(OTP_VERIFIABLE_STATUSES as readonly string[]).includes(status)) {
      return errorResponse(
        409,
        "This request cannot be completed from its current status.",
      );
    }

    if (collection.otpVerifiedAt) {
      return errorResponse(409, "This pickup was already completed.");
    }

    if (!collection.otpHash) {
      return errorResponse(409, "No OTP is registered for this request.");
    }

    if (
      collection.otpExpiresAt &&
      collection.otpExpiresAt.getTime() < Date.now()
    ) {
      return errorResponse(410, OTP_EXPIRED_MESSAGE);
    }

    const maxAttempts = collection.otpMaxAttempts ?? 5;
    if ((collection.otpAttempts ?? 0) >= maxAttempts) {
      return errorResponse(410, OTP_LOCKED_MESSAGE);
    }

    const submittedOtp = parsed.data.otp;

    // Timing-safe compare first, so a wrong OTP gets a clear 400 and we
    // never issue the atomic update with a bad hash.
    const hashMatches = verifyCollectionOtp(submittedOtp, collection.otpHash);
    if (!hashMatches) {
      const attempts = (collection.otpAttempts ?? 0) + 1;
      const locked = attempts >= maxAttempts;
      await HomeCollection.updateOne(
        { _id: parsedId.data.id, otpVerifiedAt: null },
        { $set: { otpAttempts: attempts } },
      );
      return errorResponse(
        locked ? 410 : 400,
        locked ? OTP_LOCKED_MESSAGE : INVALID_OTP_MESSAGE,
      );
    }

    // Atomic flip: only one concurrent writer wins this update.
    const completed = await HomeCollection.findOneAndUpdate(
      {
        _id: parsedId.data.id,
        status,
        otpHash: collection.otpHash,
        otpVerifiedAt: null,
      },
      {
        $set: {
          status: "COLLECTED",
          collectedAt: new Date(),
          otpVerifiedAt: new Date(),
        },
      },
      { new: true, runValidators: true },
    )
      .populate("laboratoryId", "name code isActive")
      .populate("assignedCollectorId", "name phone")
      .lean();

    if (!completed) {
      // Hash matched but the conditional update lost - another writer won.
      return errorResponse(
        409,
        "The request changed before this update could be applied. Refresh and try again.",
      );
    }

    await appendCollectionEvent({
      collectionId: String(collection._id),
      eventType: "COLLECTION_COMPLETED",
      previousStatus: status,
      newStatus: "COLLECTED",
      actorId: user.id,
      metadata: { viaOtp: true },
    });

    return itemResponse(
      toHomeCollectionDetailDto(completed, {
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
    logApiFailure("home-collections/[id]/verify-otp", error);
    return errorResponse(
      503,
      "Unable to verify the OTP right now. Please try again.",
    );
  }
}
