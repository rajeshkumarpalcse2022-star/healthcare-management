import type { ParameterDataType } from "@/config/labs";
import {
  BOOKING_EVENT_LABELS,
  type BookingEventType,
  type BookingStatus,
} from "@/config/lab-bookings";
import { COLLECTION_EVENT_LABELS } from "@/config/home-collection";
import type { CollectionEventType, CollectionStatus } from "@/config/home-collection";
import type { Clinic } from "@/types/clinic";
import type { CollectionRequestSummary } from "@/types/collection-requests";
import type { Doctor, DoctorClinicRef } from "@/types/doctor";
import type {
  BookableLabTest,
  LabBookingContact,
  LabBookingDetail,
  LabBookingEventDto,
  LabBookingItem,
  LabBookingScheduleConfig,
  LabBookingSummary,
} from "@/types/lab-booking";
import type { LabDepartment, LabDepartmentRef } from "@/types/lab-department";
import type { LabTest, LabTestParameter, ReferenceRange } from "@/types/lab-test";
import type {
  CollectorOption,
  CollectorRef,
  EligibleBookingRef,
  HomeCollectionAddressDto,
  HomeCollectionDetail,
  HomeCollectionEventDto,
  HomeCollectionItem,
  HomeCollectionSummary,
} from "@/types/home-collection";
import type {
  Laboratory,
  LaboratoryBookingConfig,
  LaboratoryRef,
} from "@/types/laboratory";

/**
 * DTO mappers - the only shapes that leave the server.
 *
 * Pure functions (no mongoose imports) so they stay trivially testable and
 * never leak driver internals, ObjectIds or populated document wrappers.
 */

interface TimestampedRecord {
  _id: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
}

interface ClinicShape extends TimestampedRecord {
  name: string;
  code: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  registrationNumber?: string | null;
  imageUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  isActive: boolean;
}

interface PopulatedClinic {
  _id: unknown;
  name: string;
  code: string;
  city?: string | null;
  imageUrl?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  isActive: boolean;
}

interface DoctorShape extends TimestampedRecord {
  userId?: unknown;
  clinicId: PopulatedClinic | unknown;
  clinicIds?: unknown[] | null;
  doctorCode: string;
  name: string;
  email: string;
  phone?: string | null;
  specialization: string;
  qualification?: string | null;
  registrationNumber?: string | null;
  experienceYears?: number | null;
  consultationFee?: number | null;
  gender?: string | null;
  dateOfBirth?: Date | string | null;
  bio?: string | null;
  profileImageUrl?: string | null;
  isActive: boolean;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Maps a stored clinic document to the public `Clinic` shape. */
export function toClinicDto(doc: ClinicShape): Clinic {
  return {
    id: String(doc._id),
    name: doc.name,
    code: doc.code,
    phone: doc.phone ?? null,
    email: doc.email ?? null,
    address: doc.address ?? null,
    city: doc.city ?? null,
    state: doc.state ?? null,
    pincode: doc.pincode ?? null,
    registrationNumber: doc.registrationNumber ?? null,
    imageUrl: doc.imageUrl ?? null,
    latitude: doc.latitude ?? null,
    longitude: doc.longitude ?? null,
    isActive: doc.isActive,
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
  };
}

function toClinicRef(raw: PopulatedClinic): DoctorClinicRef {
  return {
    id: String(raw._id),
    name: raw.name,
    code: raw.code,
    city: raw.city ?? null,
    imageUrl: raw.imageUrl ?? null,
    latitude: raw.latitude ?? null,
    longitude: raw.longitude ?? null,
    isActive: raw.isActive,
  };
}

function isPopulatedClinic(value: unknown): value is PopulatedClinic {
  return (
    value !== null &&
    typeof value === "object" &&
    "name" in value &&
    "_id" in value
  );
}

/**
 * Maps a doctor document (with `clinicId` + `clinicIds` populated) to the
 * public shape. Unpopulated or dangling clinic references surface as an empty
 * list - the UI shows "Unassigned" rather than crashing.
 */
export function toDoctorDto(doc: DoctorShape): Doctor {
  const primary = isPopulatedClinic(doc.clinicId)
    ? toClinicRef(doc.clinicId)
    : null;

  const clinics: DoctorClinicRef[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    if (!isPopulatedClinic(value)) return;
    const ref = toClinicRef(value);
    if (seen.has(ref.id)) return;
    seen.add(ref.id);
    clinics.push(ref);
  };

  if (Array.isArray(doc.clinicIds)) {
    doc.clinicIds.forEach(push);
  }
  if (primary && !seen.has(primary.id)) {
    clinics.unshift(primary);
    seen.add(primary.id);
  }

  const rawDob = doc.dateOfBirth;
  const dateOfBirth =
    rawDob === null || rawDob === undefined
      ? null
      : toIso(rawDob as Date | string);

  return {
    id: String(doc._id),
    userId: doc.userId === null || doc.userId === undefined ? null : String(doc.userId),
    clinic: primary,
    clinics,
    doctorCode: doc.doctorCode,
    name: doc.name,
    email: doc.email,
    phone: doc.phone ?? null,
    specialization: doc.specialization,
    qualification: doc.qualification ?? null,
    registrationNumber: doc.registrationNumber ?? null,
    experienceYears: doc.experienceYears ?? null,
    consultationFee: doc.consultationFee ?? null,
    gender: (doc.gender as Doctor["gender"]) ?? null,
    dateOfBirth,
    bio: doc.bio ?? null,
    profileImageUrl: doc.profileImageUrl ?? null,
    isActive: doc.isActive,
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
  };
}

/* ------------------------------------------------------------------ *
 * Lab / LIMS mappers
 * ------------------------------------------------------------------ */

interface LaboratoryBookingConfigShape {
  timezone: string;
  operatingDays: number[];
  openingTime: string;
  closingTime: string;
  slotDurationMinutes: number;
  slotCapacity: number;
  maxAdvanceDays: number;
}

interface LaboratoryShape extends TimestampedRecord {
  name: string;
  code: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  registrationNumber?: string | null;
  accreditation?: string | null;
  bookingConfig?: LaboratoryBookingConfigShape | null;
  homeCollectionConfig?: LaboratoryBookingConfigShape | null;
  isActive: boolean;
}

interface PopulatedLabRef {
  _id: unknown;
  name: string;
  code: string;
  isActive: boolean;
}

/** Converts a populated reference document to its compact ref shape. */
function toLabRef(raw: PopulatedLabRef): LaboratoryRef | LabDepartmentRef {
  return {
    id: String(raw._id),
    name: raw.name,
    code: raw.code,
    isActive: raw.isActive,
  };
}

/** Returns the ref when populated, `null` for raw ObjectIds / dangling refs. */
function toRefOrNull(raw: unknown): LaboratoryRef | LabDepartmentRef | null {
  if (
    raw !== null &&
    typeof raw === "object" &&
    "_id" in raw &&
    "name" in raw &&
    "code" in raw
  ) {
    return toLabRef(raw as PopulatedLabRef);
  }
  return null;
}

/** Maps a stored laboratory booking configuration to its DTO shape. */
function toLaboratoryBookingConfigDto(
  raw: LaboratoryBookingConfigShape | null | undefined,
): LaboratoryBookingConfig | null {
  if (!raw || typeof raw !== "object") return null;
  return {
    timezone: raw.timezone,
    operatingDays: Array.isArray(raw.operatingDays)
      ? [...raw.operatingDays]
      : [],
    openingTime: raw.openingTime,
    closingTime: raw.closingTime,
    slotDurationMinutes: raw.slotDurationMinutes,
    slotCapacity: raw.slotCapacity,
    maxAdvanceDays: raw.maxAdvanceDays,
  };
}

/** Maps a stored laboratory document to the public `Laboratory` shape. */
export function toLaboratoryDto(doc: LaboratoryShape): Laboratory {
  return {
    id: String(doc._id),
    name: doc.name,
    code: doc.code,
    phone: doc.phone ?? null,
    email: doc.email ?? null,
    address: doc.address ?? null,
    city: doc.city ?? null,
    state: doc.state ?? null,
    pincode: doc.pincode ?? null,
    registrationNumber: doc.registrationNumber ?? null,
    accreditation: doc.accreditation ?? null,
    bookingConfig: toLaboratoryBookingConfigDto(doc.bookingConfig),
    homeCollectionConfig: toLaboratoryBookingConfigDto(
      doc.homeCollectionConfig,
    ),
    isActive: doc.isActive,
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
  };
}

interface DepartmentShape extends TimestampedRecord {
  laboratoryId: unknown;
  name: string;
  code: string;
  description?: string | null;
  isActive: boolean;
}

/** Maps a department document (with `laboratoryId` populated) to the public shape. */
export function toDepartmentDto(doc: DepartmentShape): LabDepartment {
  return {
    id: String(doc._id),
    laboratory: toRefOrNull(doc.laboratoryId) as LaboratoryRef | null,
    name: doc.name,
    code: doc.code,
    description: doc.description ?? null,
    isActive: doc.isActive,
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
  };
}

interface LabTestShape extends TimestampedRecord {
  laboratoryId: unknown;
  departmentId: unknown;
  name: string;
  code: string;
  category: string;
  specimenType: string;
  methodology?: string | null;
  turnaroundTimeMinutes: number;
  description?: string | null;
  preparationInstructions?: string | null;
  price: number;
  labVisitEnabled?: boolean | null;
  homeCollectionEnabled?: boolean | null;
  isActive: boolean;
}

/** Maps a test document (with lab + department populated) to the public shape. */
export function toLabTestDto(doc: LabTestShape): LabTest {
  return {
    id: String(doc._id),
    laboratory: toRefOrNull(doc.laboratoryId) as LaboratoryRef | null,
    department: toRefOrNull(doc.departmentId) as LabDepartmentRef | null,
    name: doc.name,
    code: doc.code,
    category: doc.category,
    specimenType: doc.specimenType,
    methodology: doc.methodology ?? null,
    turnaroundTimeMinutes: doc.turnaroundTimeMinutes,
    description: doc.description ?? null,
    preparationInstructions: doc.preparationInstructions ?? null,
    price: doc.price,
    // Pre-migration documents have no stored flags; both methods were the
    // historical behaviour, so they read as enabled.
    labVisitEnabled: doc.labVisitEnabled !== false,
    homeCollectionEnabled: doc.homeCollectionEnabled !== false,
    isActive: doc.isActive,
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
  };
}

interface ParameterShape extends TimestampedRecord {
  labTestId: unknown;
  name: string;
  code: string;
  dataType: string;
  unit?: string | null;
  referenceRange?: {
    low?: number | null;
    high?: number | null;
    text?: string | null;
  } | null;
  criticalLow?: number | null;
  criticalHigh?: number | null;
  displayOrder: number;
  isRequired: boolean;
}

/** Maps a stored parameter document to the public `LabTestParameter` shape. */
export function toParameterDto(doc: ParameterShape): LabTestParameter {
  const rawRange = doc.referenceRange;
  const referenceRange: ReferenceRange | null =
    rawRange !== null && rawRange !== undefined
      ? {
          low: rawRange.low ?? null,
          high: rawRange.high ?? null,
          text: rawRange.text ?? null,
        }
      : null;

  return {
    id: String(doc._id),
    labTestId: String(doc.labTestId),
    name: doc.name,
    code: doc.code,
    dataType: doc.dataType as ParameterDataType,
    unit: doc.unit ?? null,
    referenceRange,
    criticalLow: doc.criticalLow ?? null,
    criticalHigh: doc.criticalHigh ?? null,
    displayOrder: doc.displayOrder,
    isRequired: doc.isRequired,
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
  };
}

/* ------------------------------------------------------------------ *
 * Online lab booking mappers
 * ------------------------------------------------------------------ */

interface BookingItemShape {
  labTestId: unknown;
  testCode: string;
  testName: string;
  price: number;
}

interface BookingContactShape {
  name: string;
  email?: string | null;
  phone?: string | null;
}

interface BookingScheduleConfigShape {
  timezone: string;
  operatingDays: number[];
  openingTime: string;
  closingTime: string;
  slotDurationMinutes: number;
  slotCapacity: number;
  maxAdvanceDays: number;
}

/**
 * Structural inputs the booking mappers accept. Exported so list routes can
 * cast their `.lean()` results (including populated references) without the
 * mappers ever exposing mongoose internals in their signatures.
 */
export interface LabBookingShape {
  _id: unknown;
  bookingCode: string;
  patientId: unknown;
  laboratoryId: unknown;
  items: BookingItemShape[];
  bookingDate: Date | string;
  timeSlot: string;
  timezone: string;
  patientContactSnapshot: BookingContactShape;
  status: string;
  totalAmount: number;
  notes?: string | null;
  cancellationReason?: string | null;
  cancelledAt?: Date | string | null;
  reviewedBy?: unknown;
  reviewedAt?: Date | string | null;
  rejectionReason?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function bookingDateToString(value: Date | string): string {
  const iso = toIso(value);
  return iso.slice(0, 10);
}

function toBookingContactDto(raw: BookingContactShape): LabBookingContact {
  return {
    name: raw.name,
    email: raw.email ?? null,
    phone: raw.phone ?? null,
  };
}

function toBookingItemsDto(items: BookingItemShape[]): LabBookingItem[] {
  return (items ?? []).map((item) => {
    // When the detail endpoint populates `items.labTestId` the catalogue
    // reference carries specimen details; list rows keep the raw id.
    const rawTest = item.labTestId;
    const populated =
      rawTest !== null &&
      typeof rawTest === "object" &&
      "_id" in rawTest
        ? (rawTest as {
            _id: unknown;
            specimenType?: string | null;
            preparationInstructions?: string | null;
          })
        : null;
    return {
      labTestId: populated ? String(populated._id) : String(rawTest),
      testCode: item.testCode,
      testName: item.testName,
      price: item.price,
      specimenType: populated?.specimenType ?? null,
      preparationInstructions: populated?.preparationInstructions ?? null,
    };
  });
}

function toBookingSummaryBase(doc: LabBookingShape): LabBookingSummary {
  const rawPatient = doc.patientId;
  const patientName =
    rawPatient !== null &&
    rawPatient !== undefined &&
    typeof rawPatient === "object" &&
    "name" in rawPatient
      ? String((rawPatient as { name: unknown }).name)
      : null;

  return {
    id: String(doc._id),
    bookingCode: doc.bookingCode,
    laboratory: toRefOrNull(doc.laboratoryId) as LaboratoryRef | null,
    bookingDate: bookingDateToString(doc.bookingDate),
    timeSlot: doc.timeSlot,
    timezone: doc.timezone,
    itemCount: Array.isArray(doc.items) ? doc.items.length : 0,
    totalAmount: doc.totalAmount,
    status: doc.status as BookingStatus,
    patientName,
    reviewedAt:
      doc.reviewedAt === null || doc.reviewedAt === undefined
        ? null
        : toIso(doc.reviewedAt as Date | string),
    createdAt: toIso(doc.createdAt),
  };
}

/**
 * Maps a booking to the list-row shape. Patient identity and contact
 * details are intentionally excluded here - list responses carry only what
 * the row needs.
 */
export function toLabBookingSummaryDto(doc: LabBookingShape): LabBookingSummary {
  return toBookingSummaryBase(doc);
}

/** Maps a booking to the full authorised detail shape. */
export function toLabBookingDetailDto(doc: LabBookingShape): LabBookingDetail {
  const rawPatient = doc.patientId;
  const patient =
    rawPatient !== null &&
    typeof rawPatient === "object" &&
    "_id" in rawPatient &&
    "name" in rawPatient
      ? {
          id: String((rawPatient as { _id: unknown })._id),
          name: String((rawPatient as { name: unknown }).name),
        }
      : rawPatient
        ? { id: String(rawPatient), name: "Patient" }
        : null;

  const cancelledAt = doc.cancelledAt;
  const rawReviewer = doc.reviewedBy;
  const reviewedBy =
    rawReviewer !== null &&
    rawReviewer !== undefined &&
    typeof rawReviewer === "object" &&
    "_id" in rawReviewer &&
    "name" in rawReviewer
      ? {
          id: String((rawReviewer as { _id: unknown })._id),
          name: String((rawReviewer as { name: unknown }).name),
        }
      : null;

  return {
    ...toBookingSummaryBase(doc),
    patient,
    contact: toBookingContactDto(doc.patientContactSnapshot),
    items: toBookingItemsDto(doc.items),
    notes: doc.notes ?? null,
    cancellationReason: doc.cancellationReason ?? null,
    cancelledAt:
      cancelledAt === null || cancelledAt === undefined
        ? null
        : toIso(cancelledAt as Date | string),
    reviewedBy,
    reviewedAt:
      doc.reviewedAt === null || doc.reviewedAt === undefined
        ? null
        : toIso(doc.reviewedAt as Date | string),
    rejectionReason: doc.rejectionReason ?? null,
    updatedAt: toIso(doc.updatedAt),
  };
}

interface BookingEventShape {
  _id: unknown;
  eventType: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  actorId?: unknown;
  metadata?: Record<string, string | number | boolean> | null;
  createdAt: Date | string;
}

/** Maps a booking audit-history document to its public shape. */
export function toLabBookingEventDto(doc: BookingEventShape): LabBookingEventDto {
  const rawActor = doc.actorId;
  const actor =
    rawActor !== null &&
    rawActor !== undefined &&
    typeof rawActor === "object" &&
    "_id" in rawActor &&
    "name" in rawActor
      ? {
          id: String((rawActor as { _id: unknown })._id),
          name: String((rawActor as { name: unknown }).name),
        }
      : null;

  return {
    id: String(doc._id),
    eventType: doc.eventType as BookingEventType,
    eventLabel:
      doc.eventType in BOOKING_EVENT_LABELS
        ? BOOKING_EVENT_LABELS[doc.eventType as BookingEventType]
        : doc.eventType,
    previousStatus: (doc.previousStatus as BookingStatus | null) ?? null,
    newStatus: (doc.newStatus as BookingStatus | null) ?? null,
    actor,
    reason:
      doc.metadata && typeof doc.metadata.reason === "string"
        ? doc.metadata.reason
        : null,
    createdAt: toIso(doc.createdAt),
  };
}

/** Exposed for the availability endpoint's schedule echo. */
export function toBookingScheduleConfigDto(
  raw: BookingScheduleConfigShape,
): LabBookingScheduleConfig {
  return {
    timezone: raw.timezone,
    operatingDays: [...raw.operatingDays],
    openingTime: raw.openingTime,
    closingTime: raw.closingTime,
    slotDurationMinutes: raw.slotDurationMinutes,
    slotCapacity: raw.slotCapacity,
    maxAdvanceDays: raw.maxAdvanceDays,
  };
}

interface BookableTestShape {
  _id: unknown;
  departmentId: unknown;
  name: string;
  code: string;
  category: string;
  specimenType: string;
  turnaroundTimeMinutes: number;
  price: number;
  labVisitEnabled?: boolean | null;
  homeCollectionEnabled?: boolean | null;
  preparationInstructions?: string | null;
}

/** Maps an active catalogue test to the booking-flow shape. */
export function toBookableTestDto(doc: BookableTestShape): BookableLabTest {
  const rawDepartment = doc.departmentId;
  const department =
    rawDepartment !== null &&
    typeof rawDepartment === "object" &&
    "_id" in rawDepartment &&
    "name" in rawDepartment &&
    "code" in rawDepartment
      ? {
          id: String((rawDepartment as { _id: unknown })._id),
          name: String((rawDepartment as { name: unknown }).name),
          code: String((rawDepartment as { code: unknown }).code),
        }
      : null;

  return {
    id: String(doc._id),
    name: doc.name,
    code: doc.code,
    category: doc.category,
    specimenType: doc.specimenType,
    turnaroundTimeMinutes: doc.turnaroundTimeMinutes,
    price: doc.price,
    department,
    // Missing flags (pre-migration documents) mean both methods were always
    // available - never make an existing test unbookable.
    labVisitEnabled: doc.labVisitEnabled !== false,
    homeCollectionEnabled: doc.homeCollectionEnabled !== false,
    preparationInstructions: doc.preparationInstructions ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Home sample-collection mappers (STEP 8)
 * ------------------------------------------------------------------ */

interface CollectionAddressShape {
  recipientName: string;
  phone: string;
  addressLine1: string;
  addressLine2?: string | null;
  landmark?: string | null;
  city: string;
  state: string;
  pincode: string;
  latitude?: number | null;
  longitude?: number | null;
  instructions?: string | null;
}

interface CollectionContactShape {
  name: string;
  phone?: string | null;
}

interface CollectionItemShape {
  labTestId: unknown;
  testCode: string;
  testName: string;
  price: number;
  specimenType?: string | null;
  preparationInstructions?: string | null;
}

interface PopulatedCollectorRef {
  _id: unknown;
  name: string;
  phone?: string | null;
}

/**
 * Structural inputs the collection mappers accept. Exported so list routes
 * can cast their `.lean()` results (including populated references) without
 * the mappers ever exposing mongoose internals in their signatures.
 */
export interface HomeCollectionShape {
  _id: unknown;
  collectionCode: string;
  patientId: unknown;
  laboratoryId: unknown;
  labBookingId?: unknown;
  items: CollectionItemShape[];
  collectionAddress: CollectionAddressShape;
  scheduledDate: Date | string;
  timeSlot: string;
  timezone: string;
  status: string;
  assignedCollectorId?: unknown;
  patientContactSnapshot: CollectionContactShape;
  collectionNotes?: string | null;
  cancellationReason?: string | null;
  cancelledAt?: Date | string | null;
  reviewedAt?: Date | string | null;
  rejectionReason?: string | null;
  assignedAt?: Date | string | null;
  collectorAcceptedAt?: Date | string | null;
  enRouteAt?: Date | string | null;
  arrivedAt?: Date | string | null;
  collectedAt?: Date | string | null;
  failedAt?: Date | string | null;
  failureReason?: string | null;
  otpExpiresAt?: Date | string | null;
  otpAttempts?: number;
  otpMaxAttempts?: number;
  otpVerifiedAt?: Date | string | null;
  retryOfId?: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
}

/** Capabilities the detail view derives for the current viewer. */
export interface CollectionViewerCapabilities {
  canCancel: boolean;
  canAssign: boolean;
  canConfirm: boolean;
  canReject: boolean;
  canAdvanceStatus: boolean;
  canRecordFailure: boolean;
  canRecordCollected: boolean;
}

function collectionDateToString(value: Date | string): string {
  return toIso(value).slice(0, 10);
}

function toCollectorRefOrNull(raw: unknown): CollectorRef | null {
  if (
    raw !== null &&
    typeof raw === "object" &&
    "_id" in raw &&
    "name" in raw
  ) {
    const doc = raw as PopulatedCollectorRef;
    return {
      id: String(doc._id),
      name: doc.name,
      phone: doc.phone ?? null,
    };
  }
  return null;
}

function toCollectionItemsDto(items: CollectionItemShape[]): HomeCollectionItem[] {
  return (items ?? []).map((item) => ({
    labTestId: String(item.labTestId),
    testCode: item.testCode,
    testName: item.testName,
    price: item.price,
    specimenType: item.specimenType ?? null,
    preparationInstructions: item.preparationInstructions ?? null,
  }));
}

function toCollectionAddressDto(raw: CollectionAddressShape): HomeCollectionAddressDto {
  return {
    recipientName: raw.recipientName,
    phone: raw.phone,
    addressLine1: raw.addressLine1,
    addressLine2: raw.addressLine2 ?? null,
    landmark: raw.landmark ?? null,
    city: raw.city,
    state: raw.state,
    pincode: raw.pincode,
    latitude: raw.latitude ?? null,
    longitude: raw.longitude ?? null,
    instructions: raw.instructions ?? null,
  };
}

/**
 * Maps a collection to the list-row shape. Patient identity, contact details
 * and the pickup address are intentionally excluded - list responses carry
 * only what the row needs.
 */
export function toHomeCollectionSummaryDto(
  doc: HomeCollectionShape,
): HomeCollectionSummary {
  const rawPatient = doc.patientId;
  const patientName =
    rawPatient !== null &&
    rawPatient !== undefined &&
    typeof rawPatient === "object" &&
    "name" in rawPatient
      ? String((rawPatient as { name: unknown }).name)
      : null;

  return {
    id: String(doc._id),
    collectionCode: doc.collectionCode,
    laboratory: toRefOrNull(doc.laboratoryId) as LaboratoryRef | null,
    scheduledDate: collectionDateToString(doc.scheduledDate),
    timeSlot: doc.timeSlot,
    timezone: doc.timezone,
    itemCount: Array.isArray(doc.items) ? doc.items.length : 0,
    status: doc.status as CollectionStatus,
    collector: toCollectorRefOrNull(doc.assignedCollectorId),
    patientName,
    createdAt: toIso(doc.createdAt),
  };
}

/** Maps a collection to the full authorised detail shape. */
export function toHomeCollectionDetailDto(
  doc: HomeCollectionShape,
  capabilities: CollectionViewerCapabilities,
): HomeCollectionDetail {
  const rawPatient = doc.patientId;
  const patient =
    rawPatient !== null &&
    typeof rawPatient === "object" &&
    "_id" in rawPatient &&
    "name" in rawPatient
      ? {
          id: String((rawPatient as { _id: unknown })._id),
          name: String((rawPatient as { name: unknown }).name),
        }
      : rawPatient
        ? { id: String(rawPatient), name: "Patient" }
        : null;

  const rawBooking = doc.labBookingId;
  const labBooking =
    rawBooking !== null &&
    rawBooking !== undefined &&
    typeof rawBooking === "object" &&
    "_id" in rawBooking &&
    "bookingCode" in rawBooking
      ? {
          id: String((rawBooking as { _id: unknown })._id),
          bookingCode: String((rawBooking as { bookingCode: unknown }).bookingCode),
          status: String((rawBooking as { status?: unknown }).status ?? ""),
        }
      : null;

  const rawRetry = doc.retryOfId;
  const retryOf =
    rawRetry !== null &&
    rawRetry !== undefined &&
    typeof rawRetry === "object" &&
    "_id" in rawRetry &&
    "collectionCode" in rawRetry
      ? {
          id: String((rawRetry as { _id: unknown })._id),
          collectionCode: String(
            (rawRetry as { collectionCode: unknown }).collectionCode,
          ),
        }
      : null;

  return {
    ...toHomeCollectionSummaryDto(doc),
    patient,
    contact: {
      name: doc.patientContactSnapshot.name,
      phone: doc.patientContactSnapshot.phone ?? null,
    },
    address: toCollectionAddressDto(doc.collectionAddress),
    items: toCollectionItemsDto(doc.items),
    labBooking,
    retryOf,
    collectionNotes: doc.collectionNotes ?? null,
    cancellationReason: doc.cancellationReason ?? null,
    cancelledAt:
      doc.cancelledAt === null || doc.cancelledAt === undefined
        ? null
        : toIso(doc.cancelledAt as Date | string),
    reviewedAt:
      doc.reviewedAt === null || doc.reviewedAt === undefined
        ? null
        : toIso(doc.reviewedAt as Date | string),
    rejectionReason: doc.rejectionReason ?? null,
    assignedAt:
      doc.assignedAt === null || doc.assignedAt === undefined
        ? null
        : toIso(doc.assignedAt as Date | string),
    collectorAcceptedAt:
      doc.collectorAcceptedAt === null || doc.collectorAcceptedAt === undefined
        ? null
        : toIso(doc.collectorAcceptedAt as Date | string),
    enRouteAt:
      doc.enRouteAt === null || doc.enRouteAt === undefined
        ? null
        : toIso(doc.enRouteAt as Date | string),
    arrivedAt:
      doc.arrivedAt === null || doc.arrivedAt === undefined
        ? null
        : toIso(doc.arrivedAt as Date | string),
    collectedAt:
      doc.collectedAt === null || doc.collectedAt === undefined
        ? null
        : toIso(doc.collectedAt as Date | string),
    failedAt:
      doc.failedAt === null || doc.failedAt === undefined
        ? null
        : toIso(doc.failedAt as Date | string),
    failureReason: doc.failureReason ?? null,
    // OTP metadata (never the plaintext) - only exposed when the query
    // opted in via `.select("+otpExpiresAt +otpAttempts +otpMaxAttempts
    // +otpVerifiedAt")`. Hash itself is never serialized.
    otp:
      doc.otpExpiresAt === null || doc.otpExpiresAt === undefined
        ? null
        : {
            verified:
              doc.otpVerifiedAt !== null && doc.otpVerifiedAt !== undefined,
            expiresAt: toIso(doc.otpExpiresAt as Date | string),
            attemptsRemaining: Math.max(
              0,
              (doc.otpMaxAttempts ?? 5) - (doc.otpAttempts ?? 0),
            ),
          },
    viewerCapabilities: capabilities,
    updatedAt: toIso(doc.updatedAt),
  };
}

interface CollectionEventShape {
  _id: unknown;
  eventType: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  actorId?: unknown;
  metadata?: Record<string, string | number | boolean> | null;
  createdAt: Date | string;
}

/** Maps an audit-history document to its public shape. */
export function toHomeCollectionEventDto(
  doc: CollectionEventShape,
): HomeCollectionEventDto {
  const rawActor = doc.actorId;
  const actor =
    rawActor !== null &&
    rawActor !== undefined &&
    typeof rawActor === "object" &&
    "_id" in rawActor &&
    "name" in rawActor
      ? {
          id: String((rawActor as { _id: unknown })._id),
          name: String((rawActor as { name: unknown }).name),
        }
      : null;

  return {
    id: String(doc._id),
    eventType: doc.eventType as CollectionEventType,
    eventLabel:
      doc.eventType in COLLECTION_EVENT_LABELS
        ? COLLECTION_EVENT_LABELS[doc.eventType as CollectionEventType]
        : doc.eventType,
    previousStatus: (doc.previousStatus as CollectionStatus | null) ?? null,
    newStatus: (doc.newStatus as CollectionStatus | null) ?? null,
    actor,
    reason:
      doc.metadata && typeof doc.metadata.reason === "string"
        ? doc.metadata.reason
        : null,
    createdAt: toIso(doc.createdAt),
  };
}

interface PopulatedBookingRef {
  _id: unknown;
  bookingCode: string;
  status: string;
  bookingDate: Date | string;
  timeSlot: string;
  items: CollectionItemShape[];
}

/** Maps the patient's eligible STEP 7 booking to the linking picker shape. */
export function toEligibleBookingRefDto(
  doc: PopulatedBookingRef,
): EligibleBookingRef {
  return {
    id: String(doc._id),
    bookingCode: doc.bookingCode,
    bookingDate: collectionDateToString(doc.bookingDate),
    timeSlot: doc.timeSlot,
    status: doc.status,
    items: toCollectionItemsDto(doc.items),
  };
}

/** Maps an active COLLECTOR user to the assignment picker shape. */
export function toCollectorOptionDto(doc: {
  _id: unknown;
  name: string;
  phone?: string | null;
}): CollectorOption {
  return {
    id: String(doc._id),
    name: doc.name,
    phone: doc.phone ?? null,
  };
}

/* ------------------------------------------------------------------ *
 * Central Collection Requests queue mappers
 * ------------------------------------------------------------------ */

/**
 * Merges a lab-visit booking into the queue row shape. Built on the booking
 * summary mapper so both surfaces can never drift apart.
 */
export function toCollectionRequestFromBooking(
  doc: LabBookingShape,
): CollectionRequestSummary {
  const base = toBookingSummaryBase(doc);
  return {
    id: base.id,
    requestType: "LAB_VISIT",
    reference: base.bookingCode,
    status: base.status,
    laboratory: base.laboratory,
    scheduledDate: base.bookingDate,
    timeSlot: base.timeSlot,
    timezone: base.timezone,
    itemCount: base.itemCount,
    totalAmount: base.totalAmount,
    patientName: base.patientName ?? null,
    collector: null,
    reviewedAt: base.reviewedAt ?? null,
    createdAt: base.createdAt,
  };
}

/**
 * Merges a home-collection request into the queue row shape. Built on the
 * collection summary mapper so both surfaces can never drift apart.
 */
export function toCollectionRequestFromCollection(
  doc: HomeCollectionShape,
): CollectionRequestSummary {
  const base = toHomeCollectionSummaryDto(doc);
  return {
    id: base.id,
    requestType: "HOME_COLLECTION",
    reference: base.collectionCode,
    status: base.status,
    laboratory: base.laboratory,
    scheduledDate: base.scheduledDate,
    timeSlot: base.timeSlot,
    timezone: base.timezone,
    itemCount: base.itemCount,
    totalAmount: null,
    patientName: base.patientName ?? null,
    collector: base.collector,
    reviewedAt:
      doc.reviewedAt === null || doc.reviewedAt === undefined
        ? null
        : toIso(doc.reviewedAt as Date | string),
    createdAt: base.createdAt,
  };
}
