import "server-only";

import type { CollectionEventType, CollectionStatus } from "@/config/home-collection";
import { HomeCollectionEvent } from "@/models/HomeCollectionEvent";

/**
 * Appends one audit event for a collection lifecycle action (STEP 8).
 *
 * Called only from the API routes that perform the action, with the actor
 * derived from the verified session - clients can never fabricate actors or
 * timestamps. Failures are logged, not thrown: losing an audit row must not
 * turn a successful operational action into a 5xx (the collection document
 * itself already carries the authoritative state).
 */
export async function appendCollectionEvent(input: {
  collectionId: string;
  eventType: CollectionEventType;
  previousStatus: CollectionStatus | null;
  newStatus: CollectionStatus | null;
  actorId: string;
  metadata?: Record<string, string | number | boolean> | null;
}): Promise<void> {
  try {
    await HomeCollectionEvent.create({
      collectionId: input.collectionId,
      eventType: input.eventType,
      previousStatus: input.previousStatus,
      newStatus: input.newStatus,
      actorId: input.actorId,
      metadata: input.metadata && Object.keys(input.metadata).length > 0
        ? input.metadata
        : null,
    });
  } catch (error) {
    console.error(
      "[home-collection] audit event write failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}
