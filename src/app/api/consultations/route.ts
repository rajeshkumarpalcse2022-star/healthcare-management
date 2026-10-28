import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireAuth } from "@/lib/auth";
import {
  buildListMeta,
  errorResponse,
  listResponse,
  logApiFailure,
} from "@/lib/api/response";
import {
  getActiveDoctorProfileForUser,
} from "@/lib/appointment/authorization";
import { toConsultationListItem } from "@/lib/appointment/dto";
import { connectToDatabase } from "@/lib/db";
import { containsRegex, toFieldIssues } from "@/lib/validation/common";
import { consultationListQuerySchema } from "@/lib/validation/appointment";
import { Appointment } from "@/models/Appointment";
import { ConsultationRecord } from "@/models/ConsultationRecord";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

const APPOINTMENT_POPULATE =
  "appointmentCode appointmentDate timeSlot appointmentType status";

/**
 * GET /api/consultations
 *
 * Consultation-record lists (the patient's medical records and the doctor's
 * own consultation records):
 * - PATIENT: released records only (appointments that reached COMPLETED),
 *   always their own;
 * - DOCTOR: records of appointments belonging to their linked profile;
 * - administrative and other roles: 403 - clinical records are deliberately
 *   not part of the monitoring surface.
 */
export async function GET(request: Request): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireAuth();
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  if (user.role !== ROLES.PATIENT && user.role !== ROLES.DOCTOR) {
    return errorResponse(403, "You do not have permission to view consultation records.");
  }

  const { searchParams } = new URL(request.url);
  const parsed = consultationListQuerySchema.safeParse({
    search: searchParams.get("search") ?? undefined,
    page: searchParams.get("page") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your search parameters and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const { search, page, limit } = parsed.data;

  try {
    await connectToDatabase();

    let filter: Record<string, unknown> = {};

    if (user.role === ROLES.PATIENT) {
      // Released records only: the record's appointment must be COMPLETED.
      const releasedAppointmentIds = await Appointment.find({
        patientId: user.id,
        status: "COMPLETED",
      })
        .select("_id")
        .lean();
      filter = {
        appointmentId: {
          $in: releasedAppointmentIds.map((doc) => doc._id),
        },
      };
    } else {
      const profile = await getActiveDoctorProfileForUser(user.id);
      if (!profile) {
        return errorResponse(
          403,
          "Your doctor profile is not active yet. Complete the approval process first.",
        );
      }
      filter = { doctorId: String(profile._id) };
    }

    if (search) {
      const matchingAppointments = await Appointment.find({
        appointmentCode: containsRegex(search.toUpperCase()),
      })
        .select("_id")
        .lean();
      filter.appointmentId = {
        $in: matchingAppointments.map((doc) => doc._id),
      };
    }

    const [total, docs] = await Promise.all([
      ConsultationRecord.countDocuments(filter),
      ConsultationRecord.find(filter)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("appointmentId", APPOINTMENT_POPULATE)
        .populate("patientId", "name")
        .populate("doctorId", "name specialization")
        .lean(),
    ]);

    return listResponse(
      docs.map(toConsultationListItem),
      buildListMeta(page, limit, total),
    );
  } catch (error) {
    logApiFailure("consultations", error);
    return errorResponse(
      503,
      "Unable to load consultation records right now. Please try again.",
    );
  }
}
