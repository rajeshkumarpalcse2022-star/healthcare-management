import { NextResponse } from "next/server";

import { APPOINTMENT_MAX_CLINICS_PER_DOCTOR } from "@/config/appointments";
import { ROLES } from "@/config/roles";
import { authErrorResponse, requireRole } from "@/lib/auth";
import { connectToDatabase } from "@/lib/db";
import {
  errorResponse,
  isDuplicateKeyError,
  itemResponse,
  logApiFailure,
} from "@/lib/api/response";
import { toDoctorDto } from "@/lib/api/serializers";
import {
  doctorClinicIds,
  storedClinicSchedules,
} from "@/lib/appointment/clinic-assignments";
import { Clinic } from "@/models/Clinic";
import { Doctor } from "@/models/Doctor";
import { User } from "@/models/User";
import { doctorIdSchema, doctorUpdateSchema } from "@/lib/validation/doctor";
import { toFieldIssues } from "@/lib/validation/common";

export const dynamic = "force-dynamic";

/**
 * GET /api/doctors/[id]
 *
 * - SUPER_ADMIN / ADMIN: any doctor profile.
 * - DOCTOR: only their own profile. Another doctor's id resolves to 404 so
 *   the response never confirms whether a record exists.
 * - Every other role: 403.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let user;
  try {
    user = await requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.DOCTOR);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { id } = await params;
  const parsedId = doctorIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid doctor id.");
  }

  try {
    await connectToDatabase();

    const doctor = await Doctor.findById(parsedId.data.id)
      .populate("clinicId", "name code city isActive imageUrl latitude longitude")
      .populate("clinicIds", "name code city isActive imageUrl latitude longitude")
      .lean();

    if (!doctor) {
      return errorResponse(404, "Doctor not found.");
    }

    if (user.role === ROLES.DOCTOR) {
      const owner = doctor.userId === null || doctor.userId === undefined
        ? null
        : String(doctor.userId);
      if (owner !== user.id) {
        return errorResponse(404, "Doctor not found.");
      }
    }

    return itemResponse(toDoctorDto(doctor));
  } catch (error) {
    logApiFailure("doctors/[id]", error);
    return errorResponse(
      503,
      "Unable to load the doctor right now. Please try again.",
    );
  }
}

/**
 * PATCH /api/doctors/[id]
 *
 * Partial update. Requires SUPER_ADMIN or ADMIN. Clinic reassignment is
 * validated against the clinic store (exists + active). Code changes are
 * uniqueness-checked.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await requireRole(ROLES.SUPER_ADMIN, ROLES.ADMIN);
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const { id } = await params;
  const parsedId = doctorIdSchema.safeParse({ id });
  if (!parsedId.success) {
    return errorResponse(400, "Invalid doctor id.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = doctorUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const updates = parsed.data;
  if (Object.keys(updates).length === 0) {
    return errorResponse(400, "No changes were provided.");
  }

  // `userId` is the login-account link that lets a signed-up doctor pass
  // the pending gate and reach its own appointment surfaces. Omitted =
  // unchanged, null = unlink; a provided id must be an active DOCTOR
  // account that is not already linked to another profile.
  const {
    userId: userIdInput,
    clinicId: clinicIdInput,
    clinicIds: clinicIdsInput,
    ...restUpdates
  } = updates;
  const setDocument: Record<string, unknown> = { ...restUpdates };
  if (userIdInput !== undefined) {
    setDocument.userId = userIdInput;
  }

  try {
    await connectToDatabase();

    const existing = await Doctor.findById(parsedId.data.id)
      .select(
        "_id doctorCode clinicId clinicIds clinicSchedules scheduleConfig",
      )
      .lean();
    if (!existing) {
      return errorResponse(404, "Doctor not found.");
    }

    if (userIdInput) {
      const account = await User.findById(userIdInput)
        .select("role isActive")
        .lean();
      if (!account) {
        return errorResponse(
          400,
          "The selected login account was not found.",
          [{ field: "userId", message: "Choose an existing account." }],
        );
      }
      if (account.role !== ROLES.DOCTOR) {
        return errorResponse(
          400,
          "The selected login account does not have the doctor role.",
          [{ field: "userId", message: "Choose a doctor login account." }],
        );
      }
      if (!account.isActive) {
        return errorResponse(
          400,
          "The selected login account is inactive.",
          [{ field: "userId", message: "Activate the account before linking." }],
        );
      }
      const conflict = await Doctor.findOne({
        userId: userIdInput,
        _id: { $ne: existing._id },
      })
        .select("_id")
        .lean();
      if (conflict) {
        return errorResponse(
          409,
          "This account is already linked to another doctor profile.",
          [{ field: "userId", message: "Unlink the account first." }],
        );
      }
    }

    if (updates.doctorCode && updates.doctorCode !== existing.doctorCode) {
      const duplicate = await Doctor.findOne({
        doctorCode: updates.doctorCode,
        _id: { $ne: existing._id },
      })
        .select("_id")
        .lean();
      if (duplicate) {
        return errorResponse(
          409,
          "A doctor with this code already exists. Choose a different code.",
        );
      }
    }

    let unsetLegacySchedule = false;
    const assignmentChanged =
      clinicIdInput !== undefined || clinicIdsInput !== undefined;

    if (assignmentChanged) {
      const existingIds = doctorClinicIds(existing);
      const requested = clinicIdsInput
        ? [...clinicIdsInput]
        : clinicIdInput
          ? [clinicIdInput]
          : [...existingIds];
      let primary = clinicIdInput ?? existingIds[0] ?? requested[0];
      if (!primary) {
        return errorResponse(
          400,
          "Select at least one clinic for this doctor.",
        );
      }
      if (!requested.includes(primary)) requested.unshift(primary);
      if (!requested.includes(primary)) primary = requested[0];

      const newClinicIds = [
        primary,
        ...requested.filter((id) => id !== primary),
      ];
      if (newClinicIds.length > APPOINTMENT_MAX_CLINICS_PER_DOCTOR) {
        return errorResponse(
          400,
          `A doctor can be assigned to at most ${APPOINTMENT_MAX_CLINICS_PER_DOCTOR} clinics.`,
        );
      }

      const clinics = await Clinic.find({ _id: { $in: newClinicIds } })
        .select("_id isActive")
        .lean();
      if (clinics.length !== newClinicIds.length) {
        return errorResponse(
          404,
          "One of the selected clinics was not found. Choose existing clinics.",
        );
      }
      if (clinics.some((clinic) => !clinic.isActive)) {
        return errorResponse(
          400,
          "One of the selected clinics is inactive. Activate it before assigning doctors.",
        );
      }

      const entries = storedClinicSchedules(existing).filter((entry) =>
        newClinicIds.includes(entry.clinicId),
      );
      const primaryEntry = entries.find((entry) => entry.clinicId === primary);

      setDocument.clinicId = primary;
      setDocument.clinicIds = newClinicIds;
      setDocument.clinicSchedules = entries;
      if (primaryEntry) {
        setDocument.scheduleConfig = primaryEntry.scheduleConfig;
      } else {
        unsetLegacySchedule = true;
      }
    }

    const update = unsetLegacySchedule
      ? { $set: setDocument, $unset: { scheduleConfig: "" } }
      : { $set: setDocument };

    const doctor = await Doctor.findByIdAndUpdate(
      parsedId.data.id,
      update,
      { new: true, runValidators: true },
    )
      .populate("clinicId", "name code city isActive imageUrl latitude longitude")
      .populate("clinicIds", "name code city isActive imageUrl latitude longitude")
      .lean();

    if (!doctor) {
      return errorResponse(404, "Doctor not found.");
    }

    return itemResponse(toDoctorDto(doctor));
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return errorResponse(
        409,
        "A doctor with this code already exists. Choose a different code.",
      );
    }
    logApiFailure("doctors/[id]/update", error);
    return errorResponse(
      503,
      "Unable to update the doctor right now. Please try again.",
    );
  }
}
