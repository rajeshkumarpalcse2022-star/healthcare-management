import { NextResponse } from "next/server";
import { z } from "zod";

import { canViewAppointmentManagement } from "@/config/appointments";
import { authErrorResponse, requireAuth } from "@/lib/auth";
import { errorResponse, itemResponse, logApiFailure } from "@/lib/api/response";
import { getActiveDoctorProfileForUser } from "@/lib/appointment/authorization";
import {
  doctorClinicIds,
  getDoctorClinicSchedule,
  storedClinicSchedules,
} from "@/lib/appointment/clinic-assignments";
import { toScheduleConfigDto } from "@/lib/appointment/dto";
import { findScheduleConflict } from "@/lib/appointment/schedule-conflicts";
import { connectToDatabase } from "@/lib/db";
import { Clinic } from "@/models/Clinic";
import { Doctor } from "@/models/Doctor";
import { objectIdSchema, toFieldIssues } from "@/lib/validation/common";
import {
  appointmentIdSchema,
  doctorScheduleConfigSchema,
} from "@/lib/validation/appointment";
import { todayInTimeZone } from "@/lib/utils/booking-time";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

const scheduleQuerySchema = z.object({
  clinicId: objectIdSchema.optional(),
});

const DOCTOR_SCHEDULE_FIELDS =
  "clinicId clinicIds clinicSchedules scheduleConfig isActive";

/**
 * Reads the caller's authorisation against the target doctor profile:
 * management roles may manage any schedule, a doctor only their own.
 * Returns an error response when the caller is not allowed (404 so
 * arbitrary doctor ids cannot be probed).
 */
async function authoriseScheduleAccess(
  user: SafeUser,
  doctorId: string,
): Promise<NextResponse | null> {
  if (canViewAppointmentManagement(user.role)) return null;
  if (user.role === "DOCTOR") {
    const profile = await getActiveDoctorProfileForUser(user.id);
    if (profile && String(profile._id) === doctorId) return null;
  }
  return errorResponse(404, "Doctor not found.");
}

/** Resolves and validates the clinic the schedule request targets. */
function targetClinic(
  doctor: {
    clinicId?: unknown;
    clinicIds?: unknown[] | null;
  },
  requested: string | undefined,
): string | null {
  const assigned = doctorClinicIds(doctor);
  const clinicId = requested ?? assigned[0];
  if (!clinicId || !assigned.includes(clinicId)) return null;
  return clinicId;
}

/**
 * GET /api/doctors/[id]/availability?clinicId=...
 *
 * Reads one clinic's stored schedule for the schedule editor. Without a
 * `clinicId` the doctor's primary clinic is used, preserving the original
 * single-clinic contract.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireAuth();
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { id } = await context.params;
  const parsed = appointmentIdSchema.safeParse({ id });
  if (!parsed.success) {
    return errorResponse(400, "Invalid doctor id.", toFieldIssues(parsed.error));
  }

  const { searchParams } = new URL(request.url);
  const query = scheduleQuerySchema.safeParse({
    clinicId: searchParams.get("clinicId") ?? undefined,
  });
  if (!query.success) {
    return errorResponse(
      400,
      "Invalid clinic id.",
      toFieldIssues(query.error),
    );
  }

  try {
    await connectToDatabase();

    const denied = await authoriseScheduleAccess(user, parsed.data.id);
    if (denied) return denied;

    const doctor = await Doctor.findById(parsed.data.id)
      .select(DOCTOR_SCHEDULE_FIELDS)
      .lean();
    if (!doctor) {
      return errorResponse(404, "Doctor not found.");
    }

    const clinicId = targetClinic(doctor, query.data.clinicId);
    if (!clinicId) {
      return errorResponse(
        404,
        "This doctor does not practise at the selected clinic.",
      );
    }

    return itemResponse({
      clinicId,
      scheduleConfig: toScheduleConfigDto(
        getDoctorClinicSchedule(doctor, clinicId),
      ),
      isActive: doctor.isActive,
    });
  } catch (error) {
    logApiFailure("doctors/availability", error);
    return errorResponse(
      503,
      "Unable to load the schedule right now. Please try again.",
    );
  }
}

/**
 * PATCH /api/doctors/[id]/availability?clinicId=...
 *
 * Creates, replaces or clears (body `null`) one clinic's schedule. Without
 * `clinicId` the primary clinic is updated, so existing clients keep working.
 * The candidate hours are checked against every other assigned clinic before
 * saving; overlapping doctor time is rejected with a clear 409 message.
 * Existing appointments are never rewritten by a schedule change.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireAuth();
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { id } = await context.params;
  const idParsed = appointmentIdSchema.safeParse({ id });
  if (!idParsed.success) {
    return errorResponse(400, "Invalid doctor id.", toFieldIssues(idParsed.error));
  }

  const { searchParams } = new URL(request.url);
  const query = scheduleQuerySchema.safeParse({
    clinicId: searchParams.get("clinicId") ?? undefined,
  });
  if (!query.success) {
    return errorResponse(
      400,
      "Invalid clinic id.",
      toFieldIssues(query.error),
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = doctorScheduleConfigSchema.nullable().safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check the schedule configuration and try again.",
      toFieldIssues(parsed.error),
    );
  }

  try {
    await connectToDatabase();

    const denied = await authoriseScheduleAccess(user, idParsed.data.id);
    if (denied) return denied;

    const doctor = await Doctor.findById(idParsed.data.id)
      .select(DOCTOR_SCHEDULE_FIELDS)
      .lean();
    if (!doctor) {
      return errorResponse(404, "Doctor not found.");
    }

    const clinicId = targetClinic(doctor, query.data.clinicId);
    if (!clinicId) {
      return errorResponse(
        404,
        "This doctor does not practise at the selected clinic.",
      );
    }

    const assigned = doctorClinicIds(doctor);

    if (parsed.data) {
      const clinicDocs = await Clinic.find({ _id: { $in: assigned } })
        .select("name")
        .lean();
      const names = new Map(
        clinicDocs.map((clinic) => [String(clinic._id), clinic.name]),
      );
      const otherClinics = assigned
        .filter((assignedId) => assignedId !== clinicId)
        .map((assignedId) => ({
          clinicId: assignedId,
          clinicName: names.get(assignedId) ?? "another clinic",
          schedule: getDoctorClinicSchedule(doctor, assignedId),
        }));

      const conflict = findScheduleConflict(
        parsed.data,
        clinicId,
        otherClinics,
        todayInTimeZone(parsed.data.timezone),
      );
      if (conflict) {
        return errorResponse(409, conflict.message, [
          { field: "schedule", message: conflict.message },
        ]);
      }
    }

    const entries = storedClinicSchedules(doctor).filter(
      (entry) => entry.clinicId !== clinicId,
    );
    if (parsed.data) {
      entries.push({ clinicId, scheduleConfig: parsed.data });
    }

    const setDocument: Record<string, unknown> = {
      clinicSchedules: entries.map((entry) => ({
        clinicId: entry.clinicId,
        scheduleConfig: entry.scheduleConfig,
      })),
    };

    // Mirror the primary clinic schedule onto the legacy field so older
    // readers (and the pinned contract) continue to see the same hours.
    const isPrimary = clinicId === assigned[0];
    if (isPrimary && parsed.data) {
      setDocument.scheduleConfig = parsed.data;
    }

    const update =
      isPrimary && !parsed.data
        ? { $set: setDocument, $unset: { scheduleConfig: "" } }
        : { $set: setDocument };

    await Doctor.updateOne({ _id: doctor._id }, update);

    const updated = await Doctor.findById(doctor._id)
      .select(DOCTOR_SCHEDULE_FIELDS)
      .lean();

    return itemResponse({
      clinicId,
      scheduleConfig: toScheduleConfigDto(
        updated ? getDoctorClinicSchedule(updated, clinicId) : parsed.data,
      ),
    });
  } catch (error) {
    logApiFailure("doctors/availability/save", error);
    return errorResponse(
      503,
      "Unable to save the schedule right now. Please try again.",
    );
  }
}
