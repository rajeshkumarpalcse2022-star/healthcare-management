import type {
  BookingEventType,
  BookingStatus,
} from "@/config/lab-bookings";
import type { LaboratoryRef } from "@/types/laboratory";

/**
 * Public DTO shapes for the online lab-booking module.
 *
 * Exactly what API responses carry - no ObjectIds, no driver internals, and
 * patient data only where the server has authorised the caller to see it.
 */

/** Booked test snapshot preserved at booking time. */
export interface LabBookingItem {
  labTestId: string;
  testCode: string;
  testName: string;
  price: number;
  /**
   * Specimen / preparation details resolved from the live catalogue when the
   * detail endpoint populates the item's test reference (the booking snapshot
   * itself only stores code, name and price).
   */
  specimenType: string | null;
  preparationInstructions: string | null;
}

/** Contact snapshot preserved at booking time. */
export interface LabBookingContact {
  name: string;
  email: string | null;
  phone: string | null;
}

/** Booking summary row used by list responses. */
export interface LabBookingSummary {
  id: string;
  bookingCode: string;
  laboratory: LaboratoryRef | null;
  /** `YYYY-MM-DD` */
  bookingDate: string;
  /** `HH:mm` slot start in the laboratory timezone. */
  timeSlot: string;
  timezone: string;
  itemCount: number;
  totalAmount: number;
  status: BookingStatus;
  /** Patient display name (management rows and the review queue). */
  patientName?: string | null;
  /** Review timestamp once the request has been approved or rejected. */
  reviewedAt?: string | null;
  createdAt: string;
}

/** Full booking detail returned to authorised viewers. */
export interface LabBookingDetail extends LabBookingSummary {
  patient: {
    id: string;
    name: string;
  } | null;
  contact: LabBookingContact;
  items: LabBookingItem[];
  notes: string | null;
  cancellationReason: string | null;
  cancelledAt: string | null;
  /** Lab manager (or above) who approved or rejected this request. */
  reviewedBy: {
    id: string;
    name: string;
  } | null;
  reviewedAt: string | null;
  /** Required when the request was rejected by the review queue. */
  rejectionReason: string | null;
  /** Audit timeline, included for the owner and operational viewers only. */
  history?: LabBookingEventDto[];
  updatedAt: string;
}

/** One audit-history entry. */
export interface LabBookingEventDto {
  id: string;
  eventType: BookingEventType;
  eventLabel: string;
  previousStatus: BookingStatus | null;
  newStatus: BookingStatus | null;
  actor: {
    id: string;
    name: string;
  } | null;
  /** Rejection reason (REQUEST_REJECTED events) or other short context. */
  reason?: string | null;
  createdAt: string;
}

/** Availability of one time slot. */
export interface LabBookingSlot {
  /** `HH:mm` start in the laboratory timezone. */
  start: string;
  /** `HH:mm` end. */
  end: string;
  label: string;
  remaining: number;
  available: boolean;
}

/** Scheduling configuration echoed to the booking UI. */
export interface LabBookingScheduleConfig {
  timezone: string;
  operatingDays: number[];
  openingTime: string;
  closingTime: string;
  slotDurationMinutes: number;
  slotCapacity: number;
  maxAdvanceDays: number;
}

/** `GET /api/lab-bookings/availability` payload. */
export interface LabBookingAvailability {
  laboratoryId: string;
  /** `YYYY-MM-DD` */
  date: string;
  bookable: boolean;
  /** Machine-readable reason when `bookable` is false. */
  unavailableReason:
    | "LABORATORY_NOT_FOUND"
    | "LABORATORY_INACTIVE"
    | "NOT_CONFIGURED"
    | "NOT_OPERATING_DAY"
    | "DATE_OUT_OF_RANGE"
    | null;
  /** Human message shown when `bookable` is false. */
  message: string | null;
  schedule: LabBookingScheduleConfig | null;
  slots: LabBookingSlot[];
  /** Cancellation cutoff in hours (central policy), echoed for the UI. */
  cancellationCutoffHours: number;
}

/** Minimal laboratory entry in the booking catalogue. */
export interface BookableLaboratory {
  id: string;
  name: string;
  code: string;
  city: string | null;
  state: string | null;
  address: string | null;
  phone: string | null;
  /** False when the laboratory has no online-booking configuration. */
  bookable: boolean;
  schedule: LabBookingScheduleConfig | null;
}

/** Test entry offered through the booking flow. */
export interface BookableLabTest {
  id: string;
  name: string;
  code: string;
  category: string;
  specimenType: string;
  turnaroundTimeMinutes: number;
  price: number;
  department: {
    id: string;
    name: string;
    code: string;
  } | null;
  /** Patient may visit the laboratory to provide the sample. */
  labVisitEnabled: boolean;
  /** A collector may visit the patient's home to collect the sample. */
  homeCollectionEnabled: boolean;
  /** Preparation instructions shown to the patient before pickup. */
  preparationInstructions: string | null;
}
