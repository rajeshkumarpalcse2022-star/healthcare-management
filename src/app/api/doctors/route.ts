import { NextResponse } from "next/server";

import { APPOINTMENT_MAX_CLINICS_PER_DOCTOR } from "@/config/appointments";
import { ROLES } from "@/config/roles";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import {
  buildListMeta,
  errorResponse,
  isDuplicateKeyError,
  listResponse,
  logApiFailure,
  NO_STORE,
} from "@/lib/api/response";
import { toDoctorDto } from "@/lib/api/serializers";
import { nextDoctorCode } from "@/lib/doctor/counter";
import {
  linkDoctorUser,
  provisionAccount,
} from "@/lib/provisioning";
import { Clinic } from "@/models/Clinic";
import { Doctor } from "@/models/Doctor";
import { User } from "@/models/User";
import {
  doctorCreateSchema,
  doctorListQuerySchema,
} from "@/lib/validation/doctor";
import {
  containsRegex,
  statusToBoolean,
  toFieldIssues,
} from "@/lib/validation/common";
import type { ItemResponse } from "@/types/api";
import type { Doctor as DoctorDto } from "@/types/doctor";
import type { ProvisionedCredentials } from "@/types/auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/doctors
 *
 * - SUPER_ADMIN / ADMIN: full directory with search, filters and pagination.
 * - DOCTOR: only the caller's own profile(s), so a doctor can view their own
 *   record without gaining unrestricted directory access.
 * - Every other role: 403.
 */
export async function GET(request: Request): Promise<NextResponse> {
  let user;
  try {
    user = await requireRole(
      ROLES.SUPER_ADMIN,
      ROLES.ADMIN,
      ROLES.DOCTOR,
    );
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const isDoctorRole = user.role === ROLES.DOCTOR;

  const { searchParams } = new URL(request.url);
  const parsed = doctorListQuerySchema.safeParse({
    search: searchParams.get("search") ?? undefined,
    specialization: searchParams.get("specialization") ?? undefined,
    clinic: searchParams.get("clinic") ?? undefined,
    status: searchParams.get("status") ?? "all",
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

  const { search, specialization, clinic, status, page, limit } = parsed.data;

  const filter: Record<string, unknown> = {};

  // DOCTOR role is scoped to their own profile - never the full directory.
  if (isDoctorRole) {
    filter.userId = user.id;
  }

  const isActive = statusToBoolean(status);
  if (isActive !== undefined) filter.isActive = isActive;
  if (!isDoctorRole && specialization) {
    filter.specialization = { $regex: `^${specialization.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" };
  }
  const andFilters: Record<string, unknown>[] = [];
  if (!isDoctorRole && clinic) {
    andFilters.push({
      $or: [{ clinicId: clinic }, { clinicIds: clinic }],
    });
  }
  if (!isDoctorRole && search) {
    andFilters.push({
      $or: [
        { name: containsRegex(search) },
        { doctorCode: containsRegex(search) },
        { email: containsRegex(search) },
        { phone: containsRegex(search) },
        { specialization: containsRegex(search) },
      ],
    });
  }
  if (andFilters.length > 0) filter.$and = andFilters;

  try {
    await connectToDatabase();

    const [total, docs] = await Promise.all([
      Doctor.countDocuments(filter),
      Doctor.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("clinicId", "name code city isActive imageUrl latitude longitude")
        .populate("clinicIds", "name code city isActive imageUrl latitude longitude")
        .lean(),
    ]);

    return listResponse(docs.map(toDoctorDto), buildListMeta(page, limit, total));
  } catch (error) {
    logApiFailure("doctors", error);
    return errorResponse(
      503,
      "Unable to load doctors right now. Please try again.",
    );
  }
}

/**
 * POST /api/doctors
 *
 * Creates a doctor profile linked to an existing, active clinic AND a login
 * User account in the same operation. The User account receives a generated
 * unique ID (`DOC-XXXXX`) and a temporary password; the credentials are
 * returned exactly once in the response so the administrator can hand them
 * to the doctor. Requires SUPER_ADMIN or ADMIN.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    await requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = doctorCreateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  try {
    await connectToDatabase();

    // Explicit codes are still honoured (imports/migrations); otherwise the
    // server allocates the next sequential code (`DR-0001`, ...). Retry a few
    // times if the counter ever collides with a pre-existing code.
    let doctorCode = parsed.data.doctorCode;
    if (doctorCode) {
      const existing = await Doctor.findOne({ doctorCode })
        .select("_id")
        .lean();
      if (existing) {
        return errorResponse(
          409,
          "A doctor with this code already exists. Choose a different code.",
        );
      }
    } else {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = await nextDoctorCode();
        const taken = await Doctor.findOne({ doctorCode: candidate })
          .select("_id")
          .lean();
        if (!taken) {
          doctorCode = candidate;
          break;
        }
      }
      if (!doctorCode) {
        return errorResponse(
          503,
          "Unable to allocate a doctor code right now. Please try again.",
        );
      }
    }

    const clinicIds = [
      parsed.data.clinicId,
      ...(parsed.data.clinicIds ?? []).filter(
        (id) => id !== parsed.data.clinicId,
      ),
    ];
    if (clinicIds.length > APPOINTMENT_MAX_CLINICS_PER_DOCTOR) {
      return errorResponse(
        400,
        `A doctor can be assigned to at most ${APPOINTMENT_MAX_CLINICS_PER_DOCTOR} clinics.`,
      );
    }

    const clinics = await Clinic.find({ _id: { $in: clinicIds } })
      .select("_id isActive name")
      .lean();
    if (clinics.length !== clinicIds.length) {
      return errorResponse(
        404,
        "The selected clinic was not found. Choose existing clinics.",
      );
    }
    if (clinics.some((clinic) => !clinic.isActive)) {
      return errorResponse(
        400,
        "The selected clinic is inactive. Activate it before assigning doctors.",
      );
    }

    // Provision the login account first so a failure (e.g. email already
    // taken by another user) aborts before the doctor profile is written.
    const existingUser = await User.findOne({ email: parsed.data.email })
      .select("_id")
      .lean();
    if (existingUser) {
      return errorResponse(
        409,
        "A user with this email already exists. Use a different email.",
      );
    }

    const provisioned = await provisionAccount({
      name: parsed.data.name,
      email: parsed.data.email,
      phone: parsed.data.phone ?? null,
      role: "DOCTOR",
    });

    const doctor = await Doctor.create({
      userId: provisioned.user.id,
      clinicId: parsed.data.clinicId,
      clinicIds,
      doctorCode,
      name: parsed.data.name,
      email: parsed.data.email,
      phone: parsed.data.phone ?? null,
      specialization: parsed.data.specialization,
      qualification: parsed.data.qualification ?? null,
      registrationNumber: parsed.data.registrationNumber ?? null,
      experienceYears: parsed.data.experienceYears ?? null,
      consultationFee: parsed.data.consultationFee ?? null,
      gender: parsed.data.gender ?? null,
      dateOfBirth: parsed.data.dateOfBirth ?? null,
      bio: parsed.data.bio ?? null,
      profileImageUrl: parsed.data.profileImageUrl ?? null,
      isActive: true,
    });

    // Ensure the Doctor.userId pointer is set even if create already wrote it.
    await linkDoctorUser(String(doctor._id), provisioned.user.id);

    const populated = await Doctor.findById(doctor._id)
      .populate("clinicId", "name code city isActive imageUrl latitude longitude")
      .populate("clinicIds", "name code city isActive imageUrl latitude longitude")
      .lean();

    const credentials: ProvisionedCredentials = {
      uniqueId: provisioned.user.uniqueId ?? "",
      password: provisioned.plainPassword,
    };

    // Custom envelope: doctor DTO + one-time provisioning credentials.
    return NextResponse.json<
      ItemResponse<DoctorDto> & { credentials?: ProvisionedCredentials }
    >(
      {
        success: true,
        data: toDoctorDto(populated ?? doctor.toObject()),
        credentials,
      },
      { status: 201, headers: NO_STORE },
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return errorResponse(
        409,
        "A doctor with this code already exists. Choose a different code.",
      );
    }
    logApiFailure("doctors/create", error);
    return errorResponse(
      503,
      "Unable to create the doctor right now. Please try again.",
    );
  }
}
