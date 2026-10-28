import "server-only";

import { randomBytes } from "node:crypto";

/**
 * Free online-consultation room links (Jitsi Meet).
 *
 * `meet.jit.si` rooms are open to anyone holding the URL, so every link gets
 * a random suffix - guessing an appointment code is not enough to join. The
 * full URL is persisted on the appointment when it is confirmed, so the
 * doctor and patient always see the same room.
 */

const JITSI_BASE_URL = "https://meet.jit.si";

/** Builds a fresh, unguessable Jitsi room URL for one appointment. */
export function createJitsiMeetingLink(appointmentCode: string): string {
  const code = appointmentCode
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const token = randomBytes(6).toString("hex");
  return `${JITSI_BASE_URL}/healthcare-${code || "consultation"}-${token}`;
}
