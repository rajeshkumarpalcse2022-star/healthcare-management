import { NextResponse } from "next/server";

import {
  COLLECTION_CAPACITY_HOLDING_STATUSES,
  COLLECTION_OTP_REGENERATE_COOLDOWN_SECONDS,
} from "@/config/home-collection";
import { authErrorResponse, requireAuth } from "@/lib/auth";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import { toHomeCollectionDetailDto } from "@/lib/api/serializers";
import { connectToDatabase } from "@/lib/db";
import { appendCollectionEvent } from "@/lib/home-collection/events";
import {
  collectionOtpExpiryForPickup,
  generateCollectionOtp,
  hashCollectionOtp,
} from "@/lib/home-collection/otp";
import { HomeCollection } from "@/models/HomeCollection";
import { homeCollectionIdSchema } from "@/lib/validation/home-collection";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/** Terminal / non-actionable states where a new OTP makes no sense. */
const REGENERABLE_STATUSES = COLLECTION_CAPACITY_HOLDING_STATUSES;

/**
 * POST /api/home-collections/[id]/regenerate-otp
 *
 * Lets the owning patient recover their pickup OTP (lost screenshot, wrong
 * note, regeneration after a lock). Rules:
 * - only the owning patient may call this - operational roles and other
 *   patients receive 404 (no existence probing);
 * - the request must still be in a capacity-holding, uncollected state;
 * - a 60-second cooldown between regenerations stops OTP farming;
 * - the new OTP invalidates the old hash, resets the attempt counter and
 *   extends expiry through the scheduled pickup day;
 * - the plaintext is returned exactly once in this response - only its
 *   SHA-256 hash is stored;
 * - an audit event is appended so the rotation is visible in history.
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

  try {
    await connectToDatabase();

    const collection = await HomeCollection.findById(parsedId.data.id)
      .select(
        "+otpHash +otpExpiresAt +otpIssuedAt +otpAttempts +otpMaxAttempts +otpVerifiedAt",
      )
      .populate("laboratoryId", "name code isActive")
      .populate("assignedCollectorId", "name phone")
      .lean();
    if (!collection) {
      return errorResponse(404, "Collection request not found.");
    }

    const isOwner =
      String(collection.patientId) === user.id && user.role === "PATIENT";
    if (!isOwner) {
      return errorResponse(404, "Collection request not found.");
    }

    const status = collection.status as string;
    if (
      !(REGENERABLE_STATUSES as readonly string[]).includes(status) ||
      collection.otpVerifiedAt
    ) {
      return errorResponse(
        409,
        "A new OTP cannot be generated for this request.",
      );
    }

    const issuedAt = collection.otpIssuedAt?.getTime() ?? 0;
    const cooldownMs = COLLECTION_OTP_REGENERATE_COOLDOWN_SECONDS * 1000;
    if (Date.now() - issuedAt < cooldownMs) {
      const waitSeconds = Math.ceil(
        (cooldownMs - (Date.now() - issuedAt)) / 1000,
      );
      return errorResponse(
        429,
        `Please wait ${waitSeconds} second${waitSeconds === 1 ? "" : "s"} before generating another OTP.`,
      );
    }

    const plainOtp = generateCollectionOtp();
    const otpHash = hashCollectionOtp(plainOtp);
    const otpExpiresAt = collectionOtpExpiryForPickup(collection.scheduledDate);
    const now = new Date();

    // Conditional on the stored hash so two concurrent regenerations cannot
    // both win - the loser receives 409 and retries after the cooldown.
    const updated = await HomeCollection.findOneAndUpdate(
      {
        _id: parsedId.data.id,
        otpHash: collection.otpHash,
        otpVerifiedAt: null,
        status: { $in: [...REGENERABLE_STATUSES] },
      },
      {
        $set: {
          otpHash,
          otpExpiresAt,
          otpIssuedAt: now,
          otpAttempts: 0,
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
        "The request changed before the OTP could be regenerated. Refresh and try again.",
      );
    }

    await appendCollectionEvent({
      collectionId: String(collection._id),
      eventType: "OTP_REGENERATED",
      previousStatus: null,
      newStatus: null,
      actorId: user.id,
    });

    const detail = toHomeCollectionDetailDto(updated, {
      canCancel: false,
      canAssign: false,
      canConfirm: false,
      canReject: false,
      canAdvanceStatus: false,
      canRecordFailure: false,
      canRecordCollected: false,
    });

    return itemResponse({
      ...detail,
      collectionOtp: plainOtp,
      collectionOtpExpiresAt: otpExpiresAt.toISOString(),
    });
  } catch (error) {
    logApiFailure("home-collections/[id]/regenerate-otp", error);
    return errorResponse(
      503,
      "Unable to generate a new OTP right now. Please try again.",
    );
  }
}
