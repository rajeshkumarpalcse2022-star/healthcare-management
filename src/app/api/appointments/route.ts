import { NextResponse } from "next/server";

import {
  APPOINTMENT_ACTIVE_STATUSES,
  APPOINTMENT_SLOT_CAPACITY,
  canCreateAppointment,
  canCreateAppointmentForOthers,
  canViewAppointmentManagement,
} from "@/config/appointments";
import { authErrorResponse, requireAuth } from "@/lib/auth";
import {
  buildListMeta,
  errorResponse,
  isDuplicateKeyError,
  itemResponse,
  listResponse,
  logApiFailure,
} from "@/lib/api/response";
import {
  toAppointmentDetailDto,
  toAppointmentSummaryDto,
} from "@/lib/appointment/dto";
import {
  getDoctorProfileById,
  getActiveDoctorProfileForUser,
} from "@/lib/appointment/authorization";
import {
  doctorClinicIds,
  getDoctorClinicSchedule,
} from "@/lib/appointment/clinic-assignments";
import { appendAppointmentEvent } from "@/lib/appointment/events";
import { nextAppointmentCode } from "@/lib/appointment/counter";
import { verifyAppointmentSlot } from "@/lib/appointment/schedule";
import {
  claimAppointmentSlot,
  releaseAppointmentSlotQuietly,
} from "@/lib/appointment/slots";
import { connectToDatabase } from "@/lib/db";
import { Appointment } from "@/models/Appointment";
import { Clinic } from "@/models/Clinic";
import { ConsultationRecord } from "@/models/ConsultationRecord";
import { PatientProfile } from "@/models/PatientProfile";
import { User } from "@/models/User";
import { containsRegex, toFieldIssues } from "@/lib/validation/common";
import {
  appointmentCreateSchema,
  appointmentListQuerySchema,
} from "@/lib/validation/appointment";
import { slotEnd } from "@/lib/utils/booking-time";
import type { SafeUser } from "@/types/auth";

export const dynamic = "force-dynamic";

const DATE_AT_UTC_MIDNIGHT = (date: string) =>
  new Date(`${date}T00:00:00.000Z`);

/**
 * GET /api/appointments
 *
 * Paginated appointment list scoped to the caller:
 * - patients always see only their own appointments;
 * - doctors see appointments of their linked, active doctor profile;
 * - super admin / admin see the monitoring list, optionally narrowed by
 *   doctor, status, type, date range or appointment reference.
 */
export async function GET(request: Request): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireAuth();
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  const management = canViewAppointmentManagement(user.role);
  if (!management && user.role !== "PATIENT" && user.role !== "DOCTOR") {
    return errorResponse(403, "You do not have permission to view appointments.");
  }

  const { searchParams } = new URL(request.url);
  const parsed = appointmentListQuerySchema.safeParse({
    search: searchParams.get("search") ?? undefined,
    status: searchParams.get("status") ?? "all",
    type: searchParams.get("type") ?? "all",
    dateFrom: searchParams.get("dateFrom") ?? undefined,
    dateTo: searchParams.get("dateTo") ?? undefined,
    doctor: searchParams.get("doctor") ?? undefined,
    sort: searchParams.get("sort") ?? undefined,
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

  const {
    search,
    status,
    type,
    dateFrom,
    dateTo,
    doctor,
    sort,
    page,
    limit,
  } = parsed.data;

  try {
    await connectToDatabase();

    const filter: Record<string, unknown> = {};
    if (management) {
      if (doctor) filter.doctorId = doctor;
    } else if (user.role === "PATIENT") {
      // Patients are hard-scoped to their own records; a client-supplied
      // doctor id still narrows within that scope.
      filter.patientId = user.id;
      if (doctor) filter.doctorId = doctor;
    } else {
      const profile = await getActiveDoctorProfileForUser(user.id);
      if (!profile) {
        return errorResponse(
          403,
          "Your doctor profile is not active yet. Complete the approval process first.",
        );
      }
      filter.doctorId = String(profile._id);
    }

    if (status === "ACTIVE") {
      filter.status = { $in: [...APPOINTMENT_ACTIVE_STATUSES] };
    } else if (status !== "all") {
      filter.status = status;
    }
    if (type !== "all") filter.appointmentType = type;
    if (search) filter.appointmentCode = containsRegex(search.toUpperCase());

    if (dateFrom || dateTo) {
      const range: Record<string, Date> = {};
      if (dateFrom) range.$gte = DATE_AT_UTC_MIDNIGHT(dateFrom);
      if (dateTo) range.$lte = DATE_AT_UTC_MIDNIGHT(dateTo);
      filter.appointmentDate = range;
    }

    const [total, docs] = await Promise.all([
      Appointment.countDocuments(filter),
      Appointment.find(filter)
        .sort(
          sort === "booked"
            ? { createdAt: 1, _id: 1 }
            : { appointmentDate: 1, timeSlot: 1 },
        )
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("doctorId", "name specialization qualification consultationFee profileImageUrl")
        .populate("clinicId", "name city isActive imageUrl")
        .populate("patientId", "name")
        .lean(),
    ]);

    return listResponse(
      docs.map(toAppointmentSummaryDto),
      buildListMeta(page, limit, total),
    );
  } catch (error) {
    logApiFailure("appointments", error);
    return errorResponse(
      503,
      "Unable to load appointments right now. Please try again.",
    );
  }
}

/**
 * POST /api/appointments
 *
 * Creates an appointment request after server-side verification of every
 * relationship, schedule rule, slot and capacity claim:
 *
 * 1. the patient is resolved from the session (or, for super admin / admin,
 *    from `patientUserId` pointing at an active PATIENT account) - a patient
 *    can never book on behalf of someone else;
 * 2. the doctor must exist, be active and practise at the selected active
 *    clinic, which must have its own schedule configuration;
 * 3. the date/slot must fall inside that clinic's effective schedule (weekly
 *    hours or date override, advance window, leave date, grid slot, outside
 *    breaks) and not have started already;
 * 4. capacity is claimed atomically in the slot ledger before the
 *    appointment is written, and released again if the write fails.
 */
export async function POST(request: Request): Promise<NextResponse> {
  let user: SafeUser;
  try {
    user = await requireAuth();
  } catch (error) {
    return authErrorResponse(error) ?? errorResponse(401, "Authentication required.");
  }

  if (!canCreateAppointment(user.role)) {
    return errorResponse(403, "You do not have permission to create appointments.");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "Invalid request body.");
  }

  const parsed = appointmentCreateSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      "Check your appointment details and try again.",
      toFieldIssues(parsed.error),
    );
  }

  const input = parsed.data;

  try {
    await connectToDatabase();

    /* ---------------- patient resolution (server-side only) ---------------- */
    let patientId: string;

    if (user.role === "PATIENT") {
      if (
        input.patientUserId &&
        input.patientUserId.toLowerCase() !== user.id.toLowerCase()
      ) {
        return errorResponse(
          403,
          "You can only create appointments for yourself.",
        );
      }
      patientId = user.id;
    } else {
      if (!canCreateAppointmentForOthers(user.role)) {
        return errorResponse(
          403,
          "You do not have permission to create appointments on behalf of patients.",
        );
      }
      if (!input.patientUserId) {
        return errorResponse(
          400,
          "Select the patient this appointment is for.",
          [{ field: "patientUserId", message: "A patient account is required." }],
        );
      }
      const patient = await User.findById(input.patientUserId)
        .select("name role isActive")
        .lean();
      if (!patient || !patient.isActive || patient.role !== "PATIENT") {
        return errorResponse(
          400,
          "The selected patient account was not found or is not active.",
          [{ field: "patientUserId", message: "Select an active patient account." }],
        );
      }
      patientId = String(patient._id);
    }

    // Record-level deactivate (PatientProfile.isActive === false) blocks new
    // appointments for that patient regardless of who is submitting.
    const patientProfile = await PatientProfile.findOne({ userId: patientId })
      .select("isActive")
      .lean();
    if (patientProfile && patientProfile.isActive === false) {
      return errorResponse(
        403,
        "This patient's record is deactivated. Contact an administrator to reactivate it.",
      );
    }

    /* ---------------- doctor and clinic eligibility ---------------- */
    const doctor = await getDoctorProfileById(input.doctorId);
    if (!doctor) {
      return errorResponse(404, "Doctor not found.");
    }
    if (!doctor.isActive) {
      return errorResponse(
        409,
        "This doctor is not currently accepting appointments.",
      );
    }

    const assignedClinicIds = doctorClinicIds(doctor);
    const clinicId = input.clinicId ?? assignedClinicIds[0];
    if (!clinicId || !assignedClinicIds.includes(clinicId)) {
      return errorResponse(
        400,
        "This doctor does not practise at the selected clinic.",
        [
          {
            field: "clinicId",
            message: "Choose a clinic this doctor is assigned to.",
          },
        ],
      );
    }

    const clinic = await Clinic.findById(clinicId)
      .select("name isActive")
      .lean();
    if (!clinic || !clinic.isActive) {
      return errorResponse(
        409,
        "This doctor's clinic is not currently accepting appointments.",
      );
    }

    const scheduleConfig = getDoctorClinicSchedule(doctor, clinicId);
    if (!scheduleConfig) {
      return errorResponse(
        409,
        "This doctor has not configured appointment availability yet.",
      );
    }

    /* ---------------- date and slot verification ---------------- */
    const check = verifyAppointmentSlot(
      scheduleConfig,
      input.appointmentDate,
      input.timeSlot,
    );
    if (!check.ok) {
      return errorResponse(409, check.message, [
        { field: check.field, message: check.message },
      ]);
    }

    /* ---------------- idempotent repeat submission ---------------- */
    if (input.idempotencyKey) {
      const existing = await Appointment.findOne({
        idempotencyKey: input.idempotencyKey,
      })
        .populate("doctorId", "name specialization qualification consultationFee profileImageUrl")
        .populate("clinicId", "name city isActive imageUrl")
        .populate("patientId", "name email phone")
        .lean();
      if (existing) {
        const hasConsultation = await ConsultationRecord.exists({
          appointmentId: existing._id,
        });
        return itemResponse(
          toAppointmentDetailDto(existing, {
            hasConsultation: Boolean(hasConsultation),
          }),
          200,
        );
      }
    }

    /* ---------------- atomic capacity claim ---------------- */
    const slotKey = {
      doctorId: input.doctorId,
      date: input.appointmentDate,
      timeSlot: input.timeSlot,
    };
    const claimed = await claimAppointmentSlot(
      slotKey,
      check.slotCapacity || APPOINTMENT_SLOT_CAPACITY,
    );
    if (!claimed) {
      return errorResponse(
        409,
        "The selected time slot is already taken. Choose another slot.",
        [{ field: "timeSlot", message: "No capacity left in this slot." }],
      );
    }

    /* ---------------- persist appointment ---------------- */
    let appointment;
    try {
      for (let attempt = 0; ; attempt += 1) {
        try {
          appointment = await Appointment.create({
            appointmentCode: await nextAppointmentCode(),
            patientId,
            doctorId: input.doctorId,
            clinicId,
            appointmentDate: DATE_AT_UTC_MIDNIGHT(input.appointmentDate),
            timeSlot: input.timeSlot,
            endTime: slotEnd(input.timeSlot, check.slotDurationMinutes),
            timezone: scheduleConfig.timezone,
            appointmentType: input.appointmentType,
            status: "PENDING",
            reason: input.reason ?? null,
            createdBy: user.id,
            idempotencyKey: input.idempotencyKey ?? null,
          });
          break;
        } catch (error) {
          if (!isDuplicateKeyError(error)) throw error;

          // Distinguish the two unique indexes: an idempotency replay means
          // the original appointment won the race - return it. An
          // appointment-code clash means the counter collided (rare) - retry.
          if (input.idempotencyKey) {
            const existing = await Appointment.findOne({
              idempotencyKey: input.idempotencyKey,
            })
              .populate("doctorId", "name specialization qualification consultationFee profileImageUrl")
              .populate("clinicId", "name city isActive imageUrl")
              .populate("patientId", "name email phone")
              .lean();
            if (existing) {
              await releaseAppointmentSlotQuietly(slotKey);
              return itemResponse(toAppointmentDetailDto(existing), 200);
            }
          }
          if (attempt >= 2) throw error;
        }
      }
    } catch (error) {
      await releaseAppointmentSlotQuietly(slotKey);
      throw error;
    }

    await appendAppointmentEvent({
      appointmentId: String(appointment._id),
      eventType: "APPOINTMENT_CREATED",
      previousStatus: null,
      newStatus: "PENDING",
      actorId: user.id,
    });

    const populated = await Appointment.findById(appointment._id)
      .populate("doctorId", "name specialization qualification consultationFee profileImageUrl")
      .populate("clinicId", "name city isActive imageUrl")
      .populate("patientId", "name email phone")
      .lean();

    return itemResponse(
      toAppointmentDetailDto(populated ?? appointment.toObject()),
      201,
    );
  } catch (error) {
    logApiFailure("appointments/create", error);
    return errorResponse(
      503,
      "Unable to create the appointment right now. Please try again.",
    );
  }
}
