import { NextResponse } from "next/server";

import { ROLES } from "@/config/roles";
import { authErrorResponse, requireRole } from "@/lib/auth";
import {
  buildListMeta,
  errorResponse,
  listResponse,
  logApiFailure,
} from "@/lib/api/response";
import { getActiveDoctorProfileForUser } from "@/lib/appointment/authorization";
import { connectToDatabase } from "@/lib/db";
import {
  containsRegex,
  paginationSchema,
  toFieldIssues,
} from "@/lib/validation/common";
import { Appointment } from "@/models/Appointment";
import { User } from "@/models/User";
import type { SafeUser } from "@/types/auth";
import type { DoctorPatientSummary } from "@/types/patient";

export const dynamic = "force-dynamic";

interface DoctorPatientAggregateRow {
  _id: unknown;
  visits: number;
  firstVisit: Date;
  lastVisit: Date;
  patient: {
    name: string;
    email: string;
    phone?: string | null;
  };
}

interface DoctorPatientFacet {
  rows: DoctorPatientAggregateRow[];
  total: Array<{ count: number }>;
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * GET /api/doctor/patients
 *
 * Patients the signed-in doctor has completed a consultation with, newest
 * first. Visibility is derived entirely server-side from the caller's linked,
 * active Doctor profile - a doctor can never see patients treated only by a
 * colleague.
 *
 * "Treated" means at least one appointment with this doctor reached the
 * `COMPLETED` state. Each row carries the number of completed visits plus the
 * first and most recent visit dates. Supports `search` (name/email/phone) and
 * standard pagination.
 */
export async function GET(request: Request): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireRole(ROLES.DOCTOR);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { searchParams } = new URL(request.url);
  const parsed = paginationSchema.safeParse({
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

  const { page, limit } = parsed.data;
  const search = (searchParams.get("search") ?? "").trim();

  try {
    await connectToDatabase();

    const profile = await getActiveDoctorProfileForUser(user.id);
    if (!profile) {
      return errorResponse(
        403,
        "Your doctor profile is not active yet. Complete the approval process first.",
      );
    }

    const match: Record<string, unknown> = {
      doctorId: profile._id,
      status: "COMPLETED",
    };

    if (search) {
      const matchingPatients = await User.find({
        role: ROLES.PATIENT,
        $or: [
          { name: containsRegex(search) },
          { email: containsRegex(search) },
          { phone: containsRegex(search) },
        ],
      })
        .select("_id")
        .lean();

      match.patientId = {
        $in: matchingPatients.map((patient) => patient._id),
      };
    }

    const [facets] = await Appointment.aggregate<DoctorPatientFacet>([
      { $match: match },
      {
        $group: {
          _id: "$patientId",
          visits: { $sum: 1 },
          firstVisit: { $min: "$appointmentDate" },
          lastVisit: { $max: "$appointmentDate" },
        },
      },
      { $sort: { lastVisit: -1, _id: 1 } },
      {
        $facet: {
          rows: [
            { $skip: (page - 1) * limit },
            { $limit: limit },
            {
              $lookup: {
                from: User.collection.name,
                localField: "_id",
                foreignField: "_id",
                as: "patient",
              },
            },
            { $unwind: "$patient" },
            {
              $project: {
                _id: 1,
                visits: 1,
                firstVisit: 1,
                lastVisit: 1,
                "patient.name": 1,
                "patient.email": 1,
                "patient.phone": 1,
              },
            },
          ],
          total: [{ $count: "count" }],
        },
      },
    ]);

    const rows: DoctorPatientSummary[] = (facets?.rows ?? []).map((row) => ({
      id: String(row._id),
      name: row.patient.name,
      email: row.patient.email,
      phone: row.patient.phone ?? null,
      visits: row.visits,
      firstVisit: dateOnly(row.firstVisit),
      lastVisit: dateOnly(row.lastVisit),
    }));

    return listResponse(
      rows,
      buildListMeta(page, limit, facets?.total[0]?.count ?? 0),
    );
  } catch (error) {
    logApiFailure("doctor/patients", error);
    return errorResponse(
      503,
      "Unable to load your patients right now. Please try again.",
    );
  }
}
