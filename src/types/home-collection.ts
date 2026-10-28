import type {
  CollectionEventType,
  CollectionStatus,
} from "@/config/home-collection";
import type { LaboratoryRef } from "@/types/laboratory";

/**
 * Public DTO shapes for the home sample-collection module (STEP 8).
 *
 * Exactly what API responses carry - no ObjectIds, no driver internals, and
 * patient pickup data only where the server has authorised the caller to see
 * it. List summaries NEVER include the address or contact phone; only the
 * authorised detail response does.
 */

/** Test snapshot preserved at request time. */
export interface HomeCollectionItem {
  labTestId: string;
  testCode: string;
  testName: string;
  /** Informational catalogue price - no payment is recorded by this module. */
  price: number;
  /** Specimen type at request time (e.g. Blood) - shown to collectors. */
  specimenType: string | null;
  /** Preparation instructions at request time (e.g. fasting). */
  preparationInstructions: string | null;
}

/** Pickup address as authorised in the detail response. */
export interface HomeCollectionAddressDto {
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  pincode: string;
  latitude: number | null;
  longitude: number | null;
  instructions: string | null;
}

/** Contact snapshot preserved at request time. */
export interface HomeCollectionContact {
  name: string;
  phone: string | null;
}

/** Minimal collector reference returned to authorised operational users. */
export interface CollectorRef {
  id: string;
  name: string;
  phone: string | null;
}

/** Collection summary row used by list responses (no pickup address). */
export interface HomeCollectionSummary {
  id: string;
  collectionCode: string;
  laboratory: LaboratoryRef | null;
  /** `YYYY-MM-DD` */
  scheduledDate: string;
  /** `HH:mm` slot start in the laboratory timezone. */
  timeSlot: string;
  timezone: string;
  itemCount: number;
  status: CollectionStatus;
  /** Present only for operational / collector lists. */
  collector: CollectorRef | null;
  /** Present only for operational lists (patient display name). */
  patientName?: string | null;
  /** True when the summary's patient is the authenticated caller. */
  isOwnRequest?: boolean;
  createdAt: string;
}

/** Full collection detail returned to authorised viewers. */
export interface HomeCollectionDetail extends HomeCollectionSummary {
  patient: {
    id: string;
    name: string;
  } | null;
  contact: HomeCollectionContact;
  address: HomeCollectionAddressDto;
  items: HomeCollectionItem[];
  /** Reference of the linked STEP 7 booking, when one exists. */
  labBooking: {
    id: string;
    bookingCode: string;
    status: string;
  } | null;
  /** Reference of the failed original, when this request is a retry. */
  retryOf: {
    id: string;
    collectionCode: string;
  } | null;
  collectionNotes: string | null;
  cancellationReason: string | null;
  cancelledAt: string | null;
  /** Lab manager (or above) who accepted/rejected the request. */
  reviewedAt: string | null;
  /** Required when the request is rejected. */
  rejectionReason: string | null;
  assignedAt: string | null;
  collectorAcceptedAt: string | null;
  enRouteAt: string | null;
  arrivedAt: string | null;
  collectedAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  /**
   * OTP lifecycle for the owner/collector surfaces only. The plaintext OTP
   * itself is NEVER included here - it is returned exactly once in the
   * creation response.
   */
  otp: {
    verified: boolean;
    expiresAt: string | null;
    attemptsRemaining: number;
  } | null;
  /** Viewer capability flags derived server-side from role + ownership. */
  viewerCapabilities: {
    canCancel: boolean;
    canAssign: boolean;
    canConfirm: boolean;
    canReject: boolean;
    canAdvanceStatus: boolean;
    canRecordFailure: boolean;
    canRecordCollected: boolean;
  };
  /** Audit timeline, included for the owner and operational viewers only. */
  history?: HomeCollectionEventDto[];
  updatedAt: string;
}

/** One audit-history entry. */
export interface HomeCollectionEventDto {
  id: string;
  eventType: CollectionEventType;
  eventLabel: string;
  previousStatus: CollectionStatus | null;
  newStatus: CollectionStatus | null;
  actor: {
    id: string;
    name: string;
  } | null;
  /** Rejection reason (REQUEST_REJECTED events) or other short context. */
  reason?: string | null;
  createdAt: string;
}

/** Availability of one pickup time slot. */
export interface HomeCollectionSlot {
  /** `HH:mm` start in the laboratory timezone. */
  start: string;
  /** `HH:mm` end. */
  end: string;
  label: string;
  remaining: number;
  available: boolean;
}

/** Scheduling configuration echoed to the collection UI. */
export interface HomeCollectionScheduleConfig {
  timezone: string;
  operatingDays: number[];
  openingTime: string;
  closingTime: string;
  slotDurationMinutes: number;
  slotCapacity: number;
  maxAdvanceDays: number;
}

/** `GET /api/home-collections/availability` payload. */
export interface HomeCollectionAvailability {
  laboratoryId: string;
  /** `YYYY-MM-DD` */
  date: string;
  available: boolean;
  /** Machine-readable reason when `available` is false. */
  unavailableReason:
    | "LABORATORY_NOT_FOUND"
    | "LABORATORY_INACTIVE"
    | "NOT_ENABLED"
    | "NOT_OPERATING_DAY"
    | "DATE_OUT_OF_RANGE"
    | null;
  /** Human message shown when `available` is false. */
  message: string | null;
  schedule: HomeCollectionScheduleConfig | null;
  slots: HomeCollectionSlot[];
  /** Cancellation cutoff in hours (central policy), echoed for the UI. */
  cancellationCutoffHours: number;
}

/** Minimal laboratory entry in the collection catalogue. */
export interface CollectableLaboratory {
  id: string;
  name: string;
  code: string;
  city: string | null;
  state: string | null;
  address: string | null;
  phone: string | null;
  /** False when the laboratory has not enabled home collection. */
  collectable: boolean;
  schedule: HomeCollectionScheduleConfig | null;
}

/** Patient's eligible STEP 7 booking offered for linking. */
export interface EligibleBookingRef {
  id: string;
  bookingCode: string;
  /** `YYYY-MM-DD` */
  bookingDate: string;
  timeSlot: string;
  status: string;
  items: {
    labTestId: string;
    testCode: string;
    testName: string;
    price: number;
  }[];
}

/** Collector option returned by the collectors endpoint. */
export interface CollectorOption {
  id: string;
  name: string;
  phone: string | null;
}
