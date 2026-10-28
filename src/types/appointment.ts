import type {
  AppointmentEventType,
  AppointmentStatus,
  AppointmentType,
  MeetingProvider,
} from "@/config/appointments";

/**
 * Public DTO shapes for the appointment & consultation module.
 *
 * Exactly what API responses carry - no ObjectIds, no driver internals, and
 * patient / clinical data only where the server has authorised the caller to
 * see it.
 */

/** A blocked window inside a doctor's working day. */
export interface DoctorScheduleBreak {
  /** `HH:mm` break start in the doctor's timezone. */
  start: string;
  /** `HH:mm` break end. */
  end: string;
}

/** Date-specific working hours that replace the weekly template. */
export interface DoctorScheduleDateOverride {
  /** Calendar date (`YYYY-MM-DD`) this override applies to. */
  date: string;
  /** Closed all day - no slots are generated for this date. */
  isClosed: boolean;
  openingTime: string;
  closingTime: string;
  slotDurationMinutes: number;
  slotCapacity: number;
  breaks: DoctorScheduleBreak[];
}

/** Schedule configuration for one doctor-clinic affiliation. */
export interface DoctorScheduleConfig {
  timezone: string;
  /** Weekday indexes (0 = Sunday - 6 = Saturday). */
  operatingDays: number[];
  openingTime: string;
  closingTime: string;
  slotDurationMinutes: number;
  /** Maximum simultaneous appointments per slot at this clinic. */
  slotCapacity: number;
  maxAdvanceDays: number;
  breaks: DoctorScheduleBreak[];
  /** Calendar dates (`YYYY-MM-DD`) the doctor is on leave. */
  unavailableDates: string[];
  /** Special hours or full-day closures for individual dates. */
  dateOverrides: DoctorScheduleDateOverride[];
}

/** Effective hours used for one clinic on one concrete date. */
export interface DoctorEffectiveSchedule {
  openingTime: string;
  closingTime: string;
  slotDurationMinutes: number;
  slotCapacity: number;
  breaks: DoctorScheduleBreak[];
}

/** One clinic assignment on the doctor schedule editor. */
export interface DoctorClinicScheduleOption {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  scheduleConfig: DoctorScheduleConfig | null;
}

/** Minimal clinic reference used on appointment rows. */
export interface AppointmentClinicRef {
  id: string;
  name: string;
  city: string | null;
  imageUrl: string | null;
  isActive: boolean;
}

/** Minimal doctor reference used on appointment rows. */
export interface AppointmentDoctorRef {
  id: string;
  name: string;
  specialization: string;
  qualification: string | null;
  profileImageUrl: string | null;
  /** Informational only - never collected or invoiced by this module. */
  consultationFee: number | null;
}

/** Appointment summary row used by list responses. */
export interface AppointmentSummary {
  id: string;
  appointmentCode: string;
  doctor: AppointmentDoctorRef | null;
  clinic: AppointmentClinicRef | null;
  /** Patient display name (doctor and management rows). */
  patientName?: string | null;
  /** Scheduled calendar date (`YYYY-MM-DD`). */
  date: string;
  /** `HH:mm` slot start in the doctor's timezone. */
  timeSlot: string;
  /** `HH:mm` computed slot end. */
  endTime: string;
  timezone: string;
  appointmentType: AppointmentType;
  /** Auto-created join URL for confirmed online consultations. */
  meetingLink: string | null;
  meetingProvider: MeetingProvider | null;
  meetingCreatedAt: string | null;
  status: AppointmentStatus;
  /** Patient's stated problem / visit reason. */
  reason: string | null;
  /** Why the doctor rejected this request (visible to the patient). */
  rejectionReason: string | null;
  reviewedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Full appointment detail returned to authorised viewers. */
export interface AppointmentDetail extends AppointmentSummary {
  patient: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
  } | null;
  cancellationReason: string | null;
  rejectionReason: string | null;
  reviewedBy: { id: string; name: string } | null;
  startedBy: { id: string; name: string } | null;
  completedBy: { id: string; name: string } | null;
  /** True once a consultation record exists for this appointment. */
  hasConsultation: boolean;
  /** Audit timeline, included for authorised viewers. */
  history?: AppointmentEventDto[];
  updatedAt: string;
}

/** One audit-history entry. */
export interface AppointmentEventDto {
  id: string;
  eventType: AppointmentEventType;
  eventLabel: string;
  previousStatus: AppointmentStatus | null;
  newStatus: AppointmentStatus | null;
  actor: { id: string; name: string } | null;
  /** Rejection / cancellation reason or other short context. */
  reason?: string | null;
  createdAt: string;
}

/** Availability of one appointment slot. */
export interface AppointmentSlot {
  /** `HH:mm` start in the doctor's timezone. */
  start: string;
  /** `HH:mm` end. */
  end: string;
  label: string;
  /** Remaining seats for this slot at the selected clinic. */
  remaining: number;
  available: boolean;
}

/** `GET /api/appointments/availability` payload. */
export interface AppointmentAvailability {
  doctorId: string;
  /** Clinic whose schedule and capacity were used. */
  clinicId: string;
  clinicName: string;
  /** `YYYY-MM-DD` */
  date: string;
  bookable: boolean;
  /** Machine-readable reason when `bookable` is false. */
  unavailableReason:
    | "DOCTOR_NOT_FOUND"
    | "DOCTOR_INACTIVE"
    | "CLINIC_INACTIVE"
    | "NOT_CONFIGURED"
    | "NOT_OPERATING_DAY"
    | "DATE_UNAVAILABLE"
    | "DATE_OUT_OF_RANGE"
    | null;
  /** Human message shown when `bookable` is false. */
  message: string | null;
  schedule: DoctorScheduleConfig | null;
  /** Hours actually in force on the requested date (override-aware). */
  dateSchedule: DoctorEffectiveSchedule | null;
  slots: AppointmentSlot[];
}

/** Active clinic shown on a public doctor profile. */
export interface DoctorDirectoryClinic {
  id: string;
  name: string;
  city: string | null;
  imageUrl: string | null;
  latitude: number | null;
  longitude: number | null;
  /** True when this clinic has a saved schedule. */
  scheduleConfigured: boolean;
}

/** Public-safe directory entry (never exposes contact or private fields). */
export interface DoctorDirectoryEntry {
  id: string;
  name: string;
  specialization: string;
  qualification: string | null;
  experienceYears: number | null;
  consultationFee: number | null;
  profileImageUrl: string | null;
  /** Primary active clinic (kept for existing surfaces). */
  clinic: DoctorDirectoryClinic | null;
  /** Every active clinic where this doctor consults. */
  clinics: DoctorDirectoryClinic[];
  /** True when at least one active clinic has a saved schedule. */
  scheduleConfigured: boolean;
  appointmentTypes: AppointmentType[];
}

/** Public-safe doctor profile shown before booking. */
export interface DoctorPublicProfile extends DoctorDirectoryEntry {
  bio: string | null;
}

/** One prescribed medicine inside a consultation record. */
export interface PrescriptionItem {
  medicine: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string | null;
}

/** Optional scan, report or photographed prescription attached to a record. */
export interface ConsultationAttachment {
  fileName: string;
  /** Cloudinary secure URL. */
  url: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

/** One audited field-change entry on a consultation record. */
export interface ConsultationChangeEntry {
  changedBy: { id: string; name: string } | null;
  changedAt: string;
  changedFields: string[];
}

/** `GET/PUT /api/appointments/[id]/consultation` payload. */
export interface ConsultationRecordDto {
  id: string;
  appointment: {
    id: string;
    appointmentCode: string;
    date: string;
    timeSlot: string;
    appointmentType: AppointmentType;
    status: AppointmentStatus;
    reason: string | null;
  } | null;
  patient: { id: string; name: string } | null;
  doctor: { id: string; name: string; specialization: string } | null;
  notes: string | null;
  diagnosis: string | null;
  treatmentAdvice: string | null;
  followUp: string | null;
  prescriptionItems: PrescriptionItem[];
  /** Optional scans, reports or photographed prescriptions. */
  attachments: ConsultationAttachment[];
  createdBy: { id: string; name: string } | null;
  updatedBy: { id: string; name: string } | null;
  /** Newest-first audited field changes (updates only). */
  changeHistory?: ConsultationChangeEntry[];
  createdAt: string;
  updatedAt: string;
}

/** One row of `GET /api/consultations` (patient / doctor record lists). */
export interface ConsultationListItem {
  id: string;
  appointment: {
    id: string;
    appointmentCode: string;
    date: string;
    timeSlot: string;
    appointmentType: AppointmentType;
    status: AppointmentStatus;
  } | null;
  patient: { id: string; name: string } | null;
  doctor: { id: string; name: string; specialization: string } | null;
  diagnosis: string | null;
  followUp: string | null;
  prescriptionCount: number;
  attachmentCount: number;
  createdAt: string;
  updatedAt: string;
}
