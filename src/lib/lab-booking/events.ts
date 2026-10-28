import "server-only";

import type { BookingEventType, BookingStatus } from "@/config/lab-bookings";
import { LabBookingEvent } from "@/models/LabBookingEvent";

/**
 * Appends one audit event for a lab-visit request lifecycle action.
 *
 * Mirrors `appendCollectionEvent` so both request types get identical audit
 * semantics. Called only from the API routes that perform the action, with
 * the actor derived from the verified session - clients can never fabricate
 * actors or timestamps. Failures are logged, not thrown: losing an audit row
 * must not turn a successful operational action into a 5xx (the booking
 * document itself already carries the authoritative state).
 */
export async function appendBookingEvent(input: {
  bookingId: string;
  eventType: BookingEventType;
  previousStatus: BookingStatus | null;
  newStatus: BookingStatus | null;
  actorId: string;
  metadata?: Record<string, string | number | boolean> | null;
}): Promise<void> {
  try {
    await LabBookingEvent.create({
      bookingId: input.bookingId,
      eventType: input.eventType,
      previousStatus: input.previousStatus,
      newStatus: input.newStatus,
      actorId: input.actorId,
      metadata:
        input.metadata && Object.keys(input.metadata).length > 0
          ? input.metadata
          : null,
    });
  } catch (error) {
    console.error(
      "[lab-booking] audit event write failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}
