import "server-only";

import {
  APPOINTMENT_EVENT_LABELS,
  type AppointmentStatus,
  type AppointmentType,
} from "@/config/appointments";
import {
  getDoctorClinicSchedule,
  type DoctorClinicScheduleShape,
} from "@/lib/appointment/clinic-assignments";
import type {
  AppointmentDetail,
  AppointmentEventDto,
  AppointmentSummary,
  ConsultationAttachment,
  ConsultationChangeEntry,
  ConsultationListItem,
  ConsultationRecordDto,
  DoctorDirectoryClinic,
  DoctorDirectoryEntry,
  DoctorPublicProfile,
  DoctorScheduleBreak,
  DoctorScheduleConfig,
  DoctorScheduleDateOverride,
} from "@/types/appointment";

/**
 * Pure serialisers for the appointment & consultation module.
 *
 * Convert stored documents (optionally populated with references) into the
 * public DTO shapes. Nothing here talks to the database or the session -
 * routes are responsible for authorising the caller before serialising, and
 * for choosing the projection (summary vs detail) the caller may see.
 */

/* ------------------------------- helpers ------------------------------- */

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function iso(value: unknown): string {
  return isoOrNull(value) ?? new Date(0).toISOString();
}

function dateOnly(value: unknown): string {
  return isoOrNull(value)?.slice(0, 10) ?? "";
}

interface PopulatedRef {
  _id: unknown;
  [key: string]: unknown;
}

function refOrNull(value: unknown): PopulatedRef | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && "_id" in (value as object)) {
    return value as PopulatedRef;
  }
  return null;
}

function actorOrNull(value: unknown): { id: string; name: string } | null {
  const ref = refOrNull(value);
  if (!ref) return null;
  return {
    id: String(ref._id),
    name: typeof ref.name === "string" ? ref.name : "Unknown user",
  };
}

/* ----------------------------- appointments ---------------------------- */

interface AppointmentDocLike {
  _id: unknown;
  appointmentCode: string;
  patientId: unknown;
  doctorId: unknown;
  clinicId: unknown;
  appointmentDate: unknown;
  timeSlot: string;
  endTime: string;
  timezone: string;
  appointmentType: string;
  meetingLink?: string | null;
  meetingProvider?: string | null;
  meetingCreatedAt?: unknown;
  status: string;
  reason: string | null;
  cancellationReason?: string | null;
  cancelledAt?: unknown;
  reviewedBy?: unknown;
  reviewedAt?: unknown;
  rejectionReason?: string | null;
  startedBy?: unknown;
  startedAt?: unknown;
  completedBy?: unknown;
  completedAt?: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

function doctorRef(value: unknown): AppointmentSummary["doctor"] {
  const ref = refOrNull(value);
  if (!ref) return null;
  return {
    id: String(ref._id),
    name: typeof ref.name === "string" ? ref.name : "Unknown doctor",
    specialization:
      typeof ref.specialization === "string" ? ref.specialization : "",
    qualification:
      typeof ref.qualification === "string" ? ref.qualification : null,
    profileImageUrl:
      typeof ref.profileImageUrl === "string" ? ref.profileImageUrl : null,
    consultationFee:
      typeof ref.consultationFee === "number" ? ref.consultationFee : null,
  };
}

function clinicRef(value: unknown): AppointmentSummary["clinic"] {
  const ref = refOrNull(value);
  if (!ref) return null;
  return {
    id: String(ref._id),
    name: typeof ref.name === "string" ? ref.name : "Unknown clinic",
    city: typeof ref.city === "string" ? ref.city : null,
    imageUrl: typeof ref.imageUrl === "string" ? ref.imageUrl : null,
    isActive: ref.isActive !== false,
  };
}

/**
 * List-row shape: no patient contact details, no history. The rejection
 * reason is included because it is shown to the patient on their own list.
 */
export function toAppointmentSummaryDto(
  doc: AppointmentDocLike,
): AppointmentSummary {
  const patientRef = refOrNull(doc.patientId);
  const summary: AppointmentSummary = {
    id: String(doc._id),
    appointmentCode: doc.appointmentCode,
    doctor: doctorRef(doc.doctorId),
    clinic: clinicRef(doc.clinicId),
    date: dateOnly(doc.appointmentDate),
    timeSlot: doc.timeSlot,
    endTime: doc.endTime,
    timezone: doc.timezone,
    appointmentType: doc.appointmentType as AppointmentType,
    meetingLink: doc.meetingLink ?? null,
    meetingProvider:
      (doc.meetingProvider as AppointmentSummary["meetingProvider"]) ?? null,
    meetingCreatedAt: isoOrNull(doc.meetingCreatedAt),
    status: doc.status as AppointmentStatus,
    reason: doc.reason ?? null,
    rejectionReason: doc.rejectionReason ?? null,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
  if (patientRef && typeof patientRef.name === "string") {
    summary.patientName = patientRef.name;
  }
  const reviewedAt = isoOrNull(doc.reviewedAt);
  if (reviewedAt) summary.reviewedAt = reviewedAt;
  const startedAt = isoOrNull(doc.startedAt);
  if (startedAt) summary.startedAt = startedAt;
  const completedAt = isoOrNull(doc.completedAt);
  if (completedAt) summary.completedAt = completedAt;
  const cancelledAt = isoOrNull(doc.cancelledAt);
  if (cancelledAt) summary.cancelledAt = cancelledAt;
  return summary;
}

export function toAppointmentDetailDto(
  doc: AppointmentDocLike,
  options: { history?: AppointmentEventDto[]; hasConsultation?: boolean } = {},
): AppointmentDetail {
  const patientRef = refOrNull(doc.patientId);
  return {
    ...toAppointmentSummaryDto(doc),
    patient: patientRef
      ? {
          id: String(patientRef._id),
          name:
            typeof patientRef.name === "string" ? patientRef.name : "Unknown patient",
          email:
            typeof patientRef.email === "string" ? patientRef.email : null,
          phone:
            typeof patientRef.phone === "string" ? patientRef.phone : null,
        }
      : null,
    cancellationReason: doc.cancellationReason ?? null,
    reviewedBy: actorOrNull(doc.reviewedBy),
    startedBy: actorOrNull(doc.startedBy),
    completedBy: actorOrNull(doc.completedBy),
    hasConsultation: options.hasConsultation ?? false,
    ...(options.history ? { history: options.history } : {}),
  };
}

export function toAppointmentEventDto(
  doc: {
    _id: unknown;
    eventType: string;
    previousStatus: string | null;
    newStatus: string | null;
    actorId: unknown;
    metadata?: Record<string, unknown> | null;
    createdAt: unknown;
  },
): AppointmentEventDto {
  const metadata = doc.metadata ?? null;
  const reason =
    metadata && typeof metadata.reason === "string" ? metadata.reason : null;
  return {
    id: String(doc._id),
    eventType: doc.eventType as AppointmentEventDto["eventType"],
    eventLabel:
      APPOINTMENT_EVENT_LABELS[doc.eventType as AppointmentEventDto["eventType"]] ??
      doc.eventType,
    previousStatus: doc.previousStatus as AppointmentStatus | null,
    newStatus: doc.newStatus as AppointmentStatus | null,
    actor: actorOrNull(doc.actorId),
    ...(reason ? { reason } : {}),
    createdAt: iso(doc.createdAt),
  };
}

/* --------------------------- availability ------------------------------ */

function toBreakDto(entry: Partial<DoctorScheduleBreak>): DoctorScheduleBreak {
  return {
    start: typeof entry.start === "string" ? entry.start : "00:00",
    end: typeof entry.end === "string" ? entry.end : "00:00",
  };
}

function toDateOverrideDto(
  entry: Partial<DoctorScheduleDateOverride>,
): DoctorScheduleDateOverride {
  return {
    date: typeof entry.date === "string" ? entry.date : "",
    isClosed: entry.isClosed === true,
    openingTime:
      typeof entry.openingTime === "string" ? entry.openingTime : "09:00",
    closingTime:
      typeof entry.closingTime === "string" ? entry.closingTime : "17:00",
    slotDurationMinutes:
      typeof entry.slotDurationMinutes === "number"
        ? entry.slotDurationMinutes
        : 30,
    slotCapacity:
      typeof entry.slotCapacity === "number" ? entry.slotCapacity : 1,
    breaks: Array.isArray(entry.breaks) ? entry.breaks.map(toBreakDto) : [],
  };
}

export function toScheduleConfigDto(
  config: unknown,
): DoctorScheduleConfig | null {
  if (!config || typeof config !== "object") return null;
  const raw = config as Partial<DoctorScheduleConfig>;
  if (typeof raw.timezone !== "string") return null;
  return {
    timezone: raw.timezone,
    operatingDays: Array.isArray(raw.operatingDays)
      ? [...raw.operatingDays]
      : [],
    openingTime: typeof raw.openingTime === "string" ? raw.openingTime : "09:00",
    closingTime:
      typeof raw.closingTime === "string" ? raw.closingTime : "17:00",
    slotDurationMinutes:
      typeof raw.slotDurationMinutes === "number"
        ? raw.slotDurationMinutes
        : 30,
    slotCapacity:
      typeof raw.slotCapacity === "number" ? raw.slotCapacity : 1,
    maxAdvanceDays:
      typeof raw.maxAdvanceDays === "number" ? raw.maxAdvanceDays : 30,
    breaks: Array.isArray(raw.breaks)
      ? raw.breaks.map(toBreakDto)
      : [],
    unavailableDates: Array.isArray(raw.unavailableDates)
      ? [...raw.unavailableDates]
      : [],
    dateOverrides: Array.isArray(raw.dateOverrides)
      ? raw.dateOverrides.map(toDateOverrideDto)
      : [],
  };
}

/* --------------------------- doctor directory -------------------------- */

interface DirectoryDoctorShape {
  _id: unknown;
  name: string;
  specialization: string;
  qualification?: string | null;
  experienceYears?: number | null;
  consultationFee?: number | null;
  profileImageUrl?: string | null;
  clinicId?: unknown;
  clinicIds?: unknown[] | null;
  scheduleConfig?: unknown;
  clinicSchedules?: { clinicId: unknown; scheduleConfig?: unknown }[] | null;
}

function directoryClinic(
  doctor: DirectoryDoctorShape,
  rawClinic: PopulatedRef,
): DoctorDirectoryClinic {
  const id = String(rawClinic._id);
  return {
    id,
    name: typeof rawClinic.name === "string" ? rawClinic.name : "Unknown clinic",
    city: typeof rawClinic.city === "string" ? rawClinic.city : null,
    imageUrl:
      typeof rawClinic.imageUrl === "string" ? rawClinic.imageUrl : null,
    latitude:
      typeof rawClinic.latitude === "number" ? rawClinic.latitude : null,
    longitude:
      typeof rawClinic.longitude === "number" ? rawClinic.longitude : null,
    scheduleConfigured:
      toScheduleConfigDto(
        getDoctorClinicSchedule(
          doctor as unknown as DoctorClinicScheduleShape,
          id,
        ),
      ) !== null,
  };
}

/** Every active clinic the doctor is assigned to, primary first. */
function activeDirectoryClinics(
  doctor: DirectoryDoctorShape,
): DoctorDirectoryClinic[] {
  const candidates: PopulatedRef[] = [];
  if (Array.isArray(doctor.clinicIds)) {
    for (const value of doctor.clinicIds) {
      const ref = refOrNull(value);
      if (ref && ref.isActive !== false) candidates.push(ref);
    }
  }
  const primary = refOrNull(doctor.clinicId);
  if (primary && primary.isActive !== false) candidates.push(primary);

  const seen = new Set<string>();
  return candidates.filter((ref) => {
    const id = String(ref._id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).map((ref) => directoryClinic(doctor, ref));
}

export function toDoctorDirectoryEntry(
  doc: DirectoryDoctorShape,
): DoctorDirectoryEntry {
  const clinics = activeDirectoryClinics(doc);
  return {
    id: String(doc._id),
    name: doc.name,
    specialization: doc.specialization,
    qualification: doc.qualification ?? null,
    experienceYears:
      typeof doc.experienceYears === "number" ? doc.experienceYears : null,
    consultationFee:
      typeof doc.consultationFee === "number" ? doc.consultationFee : null,
    profileImageUrl:
      typeof doc.profileImageUrl === "string" ? doc.profileImageUrl : null,
    clinic: clinics[0] ?? null,
    clinics,
    scheduleConfigured: clinics.some((clinic) => clinic.scheduleConfigured),
    appointmentTypes: ["CLINIC_VISIT", "ONLINE"],
  };
}

export function toDoctorPublicProfile(
  doc: Parameters<typeof toDoctorDirectoryEntry>[0] & { bio?: string | null },
): DoctorPublicProfile {
  return {
    ...toDoctorDirectoryEntry(doc),
    bio: doc.bio ?? null,
  };
}

/* ----------------------------- consultations --------------------------- */

interface ConsultationDocLike {
  _id: unknown;
  appointmentId: unknown;
  patientId: unknown;
  doctorId: unknown;
  notes: string | null;
  diagnosis: string | null;
  treatmentAdvice: string | null;
  followUp: string | null;
  prescriptionItems: {
    medicine: string;
    dosage: string;
    frequency: string;
    duration: string;
    instructions: string | null;
  }[];
  attachments?: {
    fileName: string;
    url: string;
    mimeType: string;
    size: number;
    uploadedAt: unknown;
  }[];
  createdBy: unknown;
  updatedBy: unknown;
  changeHistory?: {
    changedBy: unknown;
    changedAt: unknown;
    changedFields: string[];
  }[];
  createdAt: unknown;
  updatedAt: unknown;
}

function appointmentRef(value: unknown): ConsultationRecordDto["appointment"] {
  const ref = refOrNull(value);
  if (!ref) return null;
  return {
    id: String(ref._id),
    appointmentCode: String(ref.appointmentCode ?? ""),
    date: dateOnly(ref.appointmentDate),
    timeSlot: String(ref.timeSlot ?? ""),
    appointmentType: (ref.appointmentType ?? "CLINIC_VISIT") as AppointmentType,
    status: (ref.status ?? "PENDING") as AppointmentStatus,
    reason: typeof ref.reason === "string" ? ref.reason : null,
  };
}

function userRef(value: unknown): { id: string; name: string } | null {
  return actorOrNull(value);
}

export function toConsultationRecordDto(
  doc: ConsultationDocLike,
  options: { includeHistory?: boolean } = {},
): ConsultationRecordDto {
  const doctorRefValue = refOrNull(doc.doctorId);
  const dto: ConsultationRecordDto = {
    id: String(doc._id),
    appointment: appointmentRef(doc.appointmentId),
    patient: userRef(doc.patientId),
    doctor: doctorRefValue
      ? {
          id: String(doctorRefValue._id),
          name:
            typeof doctorRefValue.name === "string"
              ? doctorRefValue.name
              : "Unknown doctor",
          specialization:
            typeof doctorRefValue.specialization === "string"
              ? doctorRefValue.specialization
              : "",
        }
      : null,
    notes: doc.notes ?? null,
    diagnosis: doc.diagnosis ?? null,
    treatmentAdvice: doc.treatmentAdvice ?? null,
    followUp: doc.followUp ?? null,
    prescriptionItems: doc.prescriptionItems.map((item) => ({
      medicine: item.medicine,
      dosage: item.dosage,
      frequency: item.frequency,
      duration: item.duration,
      instructions: item.instructions ?? null,
    })),
    attachments: (doc.attachments ?? []).map(
      (attachment): ConsultationAttachment => ({
        fileName: attachment.fileName,
        url: attachment.url,
        mimeType: attachment.mimeType,
        size: attachment.size,
        uploadedAt: iso(attachment.uploadedAt),
      }),
    ),
    createdBy: userRef(doc.createdBy),
    updatedBy: userRef(doc.updatedBy),
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
  if (options.includeHistory && doc.changeHistory) {
    const history: ConsultationChangeEntry[] = doc.changeHistory.map(
      (entry) => ({
        changedBy: userRef(entry.changedBy),
        changedAt: iso(entry.changedAt),
        changedFields: [...entry.changedFields],
      }),
    );
    dto.changeHistory = history;
  }
  return dto;
}

export function toConsultationListItem(
  doc: ConsultationDocLike,
): ConsultationListItem {
  const appointment = appointmentRef(doc.appointmentId);
  const doctorRefValue = refOrNull(doc.doctorId);
  return {
    id: String(doc._id),
    appointment: appointment
      ? {
          id: appointment.id,
          appointmentCode: appointment.appointmentCode,
          date: appointment.date,
          timeSlot: appointment.timeSlot,
          appointmentType: appointment.appointmentType,
          status: appointment.status,
        }
      : null,
    patient: userRef(doc.patientId),
    doctor: doctorRefValue
      ? {
          id: String(doctorRefValue._id),
          name:
            typeof doctorRefValue.name === "string"
              ? doctorRefValue.name
              : "Unknown doctor",
          specialization:
            typeof doctorRefValue.specialization === "string"
              ? doctorRefValue.specialization
              : "",
        }
      : null,
    diagnosis: doc.diagnosis ?? null,
    followUp: doc.followUp ?? null,
    prescriptionCount: Array.isArray(doc.prescriptionItems)
      ? doc.prescriptionItems.length
      : 0,
    attachmentCount: Array.isArray(doc.attachments)
      ? doc.attachments.length
      : 0,
    createdAt: iso(doc.createdAt),
    updatedAt: iso(doc.updatedAt),
  };
}
