import "server-only";

import type {
  AppointmentEventType,
  AppointmentStatus,
} from "@/config/appointments";
import { AppointmentEvent } from "@/models/AppointmentEvent";

/**
 * Appends one audit event for an appointment lifecycle action.
 *
 * Mirrors `appendBookingEvent` so both request types get identical audit
 * semantics. Called only from the API routes that perform the action, with
 * the actor derived from the verified session - clients can never fabricate
 * actors or timestamps. Failures are logged, not thrown: losing an audit row
 * must not turn a successful operational action into a 5xx (the appointment
 * document itself already carries the authoritative state).
 */
export async function appendAppointmentEvent(input: {
  appointmentId: string;
  eventType: AppointmentEventType;
  previousStatus: AppointmentStatus | null;
  newStatus: AppointmentStatus | null;
  actorId: string;
  metadata?: Record<string, string | number | boolean> | null;
}): Promise<void> {
  try {
    await AppointmentEvent.create({
      appointmentId: input.appointmentId,
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
      "[appointment] audit event write failed:",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}
