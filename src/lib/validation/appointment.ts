import { z } from "zod";

import {
  APPOINTMENT_ACTIVE_FILTER,
  APPOINTMENT_LIST_SORTS,
  APPOINTMENT_MAX_ADVANCE_DAYS_MAX,
  APPOINTMENT_MAX_ADVANCE_DAYS_MIN,
  APPOINTMENT_MAX_BREAKS,
  APPOINTMENT_MAX_DATE_OVERRIDES,
  APPOINTMENT_MAX_UNAVAILABLE_DATES,
  APPOINTMENT_REASON_MAX_LENGTH,
  APPOINTMENT_SLOT_CAPACITY_MAX,
  APPOINTMENT_SLOT_CAPACITY_MIN,
  APPOINTMENT_SLOT_DURATION_MINUTES_MAX,
  APPOINTMENT_SLOT_DURATION_MINUTES_MIN,
  APPOINTMENT_STATUS_FILTERS,
  APPOINTMENT_TYPE_FILTERS,
  APPOINTMENT_TYPES,
  CONSULTATION_ATTACHMENT_MAX_BYTES,
  CONSULTATION_ATTACHMENT_MIME_TYPES,
  CONSULTATION_DIAGNOSIS_MAX_LENGTH,
  CONSULTATION_FOLLOW_UP_MAX_LENGTH,
  CONSULTATION_NOTES_MAX_LENGTH,
  CONSULTATION_TREATMENT_MAX_LENGTH,
  DEFAULT_APPOINTMENT_SLOT_CAPACITY,
  MAX_CONSULTATION_ATTACHMENTS,
  MAX_PRESCRIPTION_ITEMS,
  PRESCRIPTION_DOSAGE_MAX_LENGTH,
  PRESCRIPTION_DURATION_MAX_LENGTH,
  PRESCRIPTION_FREQUENCY_MAX_LENGTH,
  PRESCRIPTION_INSTRUCTIONS_MAX_LENGTH,
  PRESCRIPTION_MEDICINE_MAX_LENGTH,
} from "@/config/appointments";
import { isValidTimeZone } from "@/lib/utils/booking-time";
import { objectIdSchema, paginationSchema } from "./common";

/**
 * Request validation for the appointment endpoints.
 *
 * Runs once in the browser for instant feedback and again on the server,
 * which is the only place that actually enforces the rules. Server handlers
 * additionally re-verify every relationship, schedule and capacity claim
 * against the database - these schemas only shape the payload.
 */

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `YYYY-MM-DD` calendar date (format-level check; timezone rules are server-side). */
export const appointmentDateStringSchema = z
  .string("Appointment date is required.")
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Appointment date must be in YYYY-MM-DD format.")
  .refine((value) => {
    const [year, month, day] = value.split("-").map(Number);
    const probe = new Date(Date.UTC(year, month - 1, day));
    return (
      probe.getUTCFullYear() === year &&
      probe.getUTCMonth() === month - 1 &&
      probe.getUTCDate() === day
    );
  }, "Enter a valid calendar date.");

/** `HH:mm` slot start. */
export const timeSlotStringSchema = z
  .string("Time slot is required.")
  .trim()
  .regex(TIME_PATTERN, "Time slot must be in HH:mm format.");

/** Optional free-text reason (visit reason / cancellation / rejection). */
const reasonText = (label: string) =>
  z
    .string()
    .trim()
    .max(
      APPOINTMENT_REASON_MAX_LENGTH,
      `${label} must be ${APPOINTMENT_REASON_MAX_LENGTH} characters or fewer.`,
    )
    .nullable()
    .optional();

/**
 * Create payload.
 *
 * The clinic must be one the doctor is assigned to. When omitted, the
 * doctor's primary clinic is used for backward compatibility. The patient is
 * resolved from the session (or, for permitted administrative roles, from
 * `patientUserId`).
 */
export const appointmentCreateSchema = z.object({
  doctorId: objectIdSchema,
  clinicId: objectIdSchema.optional(),
  appointmentDate: appointmentDateStringSchema,
  timeSlot: timeSlotStringSchema,
  appointmentType: z.enum(APPOINTMENT_TYPES, {
    message: "Appointment type must be a clinic visit or an online consultation.",
  }),
  reason: reasonText("Reason"),
  /** Only honoured for roles allowed to book on behalf of a patient. */
  patientUserId: objectIdSchema.optional(),
  /**
   * Optional client-generated key making retried submissions idempotent.
   * The server treats a repeat of the same key as the original request
   * rather than a second appointment.
   */
  idempotencyKey: z
    .string()
    .trim()
    .min(8, "Idempotency key is too short.")
    .max(100, "Idempotency key is too long.")
    .regex(
      /^[A-Za-z0-9_-]+$/,
      "Idempotency key may only contain letters, numbers, dashes and underscores.",
    )
    .optional(),
});

export type AppointmentCreateInput = z.infer<typeof appointmentCreateSchema>;

/** Cancellation payload - the reason is optional but recorded when given. */
export const appointmentCancelSchema = z.object({
  reason: reasonText("Reason"),
});

export type AppointmentCancelInput = z.infer<typeof appointmentCancelSchema>;

/**
 * Operational status payload. Only forward transitions are accepted
 * (validated on the server against the transition table); `CANCELLED` is
 * reachable exclusively through the dedicated cancel endpoint and a
 * rejection requires a reason.
 */
export const appointmentStatusSchema = z
  .object({
    status: z.enum(["CONFIRMED", "REJECTED", "IN_PROGRESS", "COMPLETED"], {
      message: "Status must be CONFIRMED, REJECTED, IN_PROGRESS or COMPLETED.",
    }),
    reason: z
      .string()
      .trim()
      .min(3, "Reason must be at least 3 characters.")
      .max(
        APPOINTMENT_REASON_MAX_LENGTH,
        `Reason must be ${APPOINTMENT_REASON_MAX_LENGTH} characters or fewer.`,
      )
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === "REJECTED" && !value.reason) {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "A rejection reason is required.",
      });
    }
  });

export type AppointmentStatusInput = z.infer<typeof appointmentStatusSchema>;

/**
 * Reschedule payload. The appointment type is intentionally fixed at
 * booking time - changing it would silently alter what the patient booked.
 */
export const appointmentRescheduleSchema = z.object({
  appointmentDate: appointmentDateStringSchema,
  timeSlot: timeSlotStringSchema,
});

export type AppointmentRescheduleInput = z.infer<
  typeof appointmentRescheduleSchema
>;

/** Availability query parameters. */
export const appointmentAvailabilityQuerySchema = z.object({
  doctorId: objectIdSchema,
  clinicId: objectIdSchema.optional(),
  date: appointmentDateStringSchema,
});

export type AppointmentAvailabilityQuery = z.infer<
  typeof appointmentAvailabilityQuerySchema
>;

/** List query parameters: search + status + type + date range + pagination. */
export const appointmentListQuerySchema = z.object({
  search: z
    .string()
    .trim()
    .max(120, "Search term is too long.")
    .regex(
      /^[A-Za-z0-9-]*$/,
      "Search by appointment reference using letters, numbers and hyphens.",
    )
    .optional(),
  status: z
    .enum([...APPOINTMENT_STATUS_FILTERS, APPOINTMENT_ACTIVE_FILTER])
    .default("all"),
  type: z.enum(APPOINTMENT_TYPE_FILTERS).default("all"),
  dateFrom: appointmentDateStringSchema.optional(),
  dateTo: appointmentDateStringSchema.optional(),
  doctor: objectIdSchema.optional(),
  sort: z.enum(APPOINTMENT_LIST_SORTS).default("slot"),
  ...paginationSchema.shape,
});

export type AppointmentListQuery = z.infer<typeof appointmentListQuerySchema>;

/** Path param validation for `/api/appointments/[id]`. */
export const appointmentIdSchema = z.object({
  id: objectIdSchema,
});

/** Shared break-window list used by weekly and date-specific schedules. */
const scheduleBreaksSchema = z
  .array(
    z.object({
      start: z
        .string()
        .trim()
        .regex(TIME_PATTERN, "Break start must be in HH:mm format."),
      end: z
        .string()
        .trim()
        .regex(TIME_PATTERN, "Break end must be in HH:mm format."),
    }),
  )
  .max(
    APPOINTMENT_MAX_BREAKS,
    `Configure at most ${APPOINTMENT_MAX_BREAKS} breaks.`,
  )
  .default([])
  .superRefine((breaks, ctx) => {
    breaks.forEach((breakWindow, index) => {
      if (breakWindow.end <= breakWindow.start) {
        ctx.addIssue({
          code: "custom",
          path: [index, "end"],
          message: "Break end must be later than its start.",
        });
      }
    });
  });

const scheduleCapacitySchema = z
  .number("Seats per slot is required.")
  .int("Seats per slot must be a whole number.")
  .min(
    APPOINTMENT_SLOT_CAPACITY_MIN,
    `Seats per slot must be at least ${APPOINTMENT_SLOT_CAPACITY_MIN}.`,
  )
  .max(
    APPOINTMENT_SLOT_CAPACITY_MAX,
    `Seats per slot must be at most ${APPOINTMENT_SLOT_CAPACITY_MAX}.`,
  );

/** Date-specific hours; `isClosed` replaces the weekly template for that day. */
const doctorScheduleDateOverrideSchema = z
  .object({
    date: appointmentDateStringSchema,
    isClosed: z.boolean().default(false),
    openingTime: z
      .string("Opening time is required.")
      .trim()
      .regex(TIME_PATTERN, "Opening time must be in HH:mm format."),
    closingTime: z
      .string("Closing time is required.")
      .trim()
      .regex(TIME_PATTERN, "Closing time must be in HH:mm format."),
    slotDurationMinutes: z
      .number("Slot duration is required.")
      .int("Slot duration must be a whole number of minutes.")
      .min(
        APPOINTMENT_SLOT_DURATION_MINUTES_MIN,
        `Slot duration must be at least ${APPOINTMENT_SLOT_DURATION_MINUTES_MIN} minutes.`,
      )
      .max(
        APPOINTMENT_SLOT_DURATION_MINUTES_MAX,
        `Slot duration must be at most ${APPOINTMENT_SLOT_DURATION_MINUTES_MAX} minutes.`,
      ),
    slotCapacity: scheduleCapacitySchema,
    breaks: scheduleBreaksSchema,
  })
  .superRefine((override, ctx) => {
    if (!override.isClosed && override.closingTime <= override.openingTime) {
      ctx.addIssue({
        code: "custom",
        path: ["closingTime"],
        message: "Closing time must be later than the opening time.",
      });
    }
  });

/**
 * Doctor schedule configuration accepted on the availability endpoint.
 *
 * Same field shape as the laboratory booking configuration plus breaks,
 * date-specific unavailability, special date hours and a per-clinic seat
 * capacity. Each clinic assignment stores its own copy of this shape.
 */
export const doctorScheduleConfigSchema = z
  .object({
    timezone: z
      .string("Timezone is required.")
      .trim()
      .max(64, "Timezone is too long.")
      .refine(
        (value) => isValidTimeZone(value),
        "Enter a valid IANA timezone (e.g. Asia/Kolkata).",
      ),
    operatingDays: z
      .array(
        z
          .number()
          .int("Operating days must be whole numbers.")
          .min(0, "Weekday index must be 0 (Sunday) or later.")
          .max(6, "Weekday index must be 6 (Saturday) or earlier."),
      )
      .min(1, "Select at least one operating day.")
      .max(7, "Select at most seven operating days.")
      .refine(
        (days) => new Set(days).size === days.length,
        "Operating days must not contain duplicates.",
      ),
    openingTime: z
      .string("Opening time is required.")
      .trim()
      .regex(TIME_PATTERN, "Opening time must be in HH:mm format."),
    closingTime: z
      .string("Closing time is required.")
      .trim()
      .regex(TIME_PATTERN, "Closing time must be in HH:mm format."),
    slotDurationMinutes: z
      .number("Slot duration is required.")
      .int("Slot duration must be a whole number of minutes.")
      .min(
        APPOINTMENT_SLOT_DURATION_MINUTES_MIN,
        `Slot duration must be at least ${APPOINTMENT_SLOT_DURATION_MINUTES_MIN} minutes.`,
      )
      .max(
        APPOINTMENT_SLOT_DURATION_MINUTES_MAX,
        `Slot duration must be at most ${APPOINTMENT_SLOT_DURATION_MINUTES_MAX} minutes.`,
      ),
    slotCapacity: scheduleCapacitySchema.default(
      DEFAULT_APPOINTMENT_SLOT_CAPACITY,
    ),
    maxAdvanceDays: z
      .number("Advance booking window is required.")
      .int("Advance booking window must be a whole number of days.")
      .min(
        APPOINTMENT_MAX_ADVANCE_DAYS_MIN,
        `Advance window must be at least ${APPOINTMENT_MAX_ADVANCE_DAYS_MIN} day(s).`,
      )
      .max(
        APPOINTMENT_MAX_ADVANCE_DAYS_MAX,
        `Advance window must be at most ${APPOINTMENT_MAX_ADVANCE_DAYS_MAX} days.`,
      ),
    breaks: scheduleBreaksSchema,
    unavailableDates: z
      .array(appointmentDateStringSchema)
      .max(
        APPOINTMENT_MAX_UNAVAILABLE_DATES,
        `Mark at most ${APPOINTMENT_MAX_UNAVAILABLE_DATES} unavailable dates.`,
      )
      .default([])
      .refine(
        (dates) => new Set(dates).size === dates.length,
        "Unavailable dates must not contain duplicates.",
      ),
    dateOverrides: z
      .array(doctorScheduleDateOverrideSchema)
      .max(
        APPOINTMENT_MAX_DATE_OVERRIDES,
        `Configure at most ${APPOINTMENT_MAX_DATE_OVERRIDES} date overrides.`,
      )
      .default([])
      .refine(
        (dates) => new Set(dates.map((entry) => entry.date)).size === dates.length,
        "Date overrides must not contain duplicate dates.",
      ),
  })
  .refine(
    (config) => config.closingTime > config.openingTime,
    {
      path: ["closingTime"],
      message: "Closing time must be later than the opening time.",
    },
  );

export type DoctorScheduleConfigInput = z.infer<
  typeof doctorScheduleConfigSchema
>;

/** Query parameters for the patient-facing doctor directory. */
export const doctorDirectoryQuerySchema = z.object({
  search: z.string().trim().max(120, "Search term is too long.").optional(),
  specialization: z.string().trim().max(80).optional(),
  clinic: objectIdSchema.optional(),
  ...paginationSchema.shape,
});

export type DoctorDirectoryQuery = z.infer<typeof doctorDirectoryQuerySchema>;

/* ------------------------------------------------------------------ *
 * Consultation record payloads
 * ------------------------------------------------------------------ */

const consultationText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`);

export const prescriptionItemSchema = z.object({
  medicine: consultationText(
    PRESCRIPTION_MEDICINE_MAX_LENGTH,
    "Medicine name",
  ).min(1, "Medicine name is required."),
  dosage: consultationText(
    PRESCRIPTION_DOSAGE_MAX_LENGTH,
    "Dosage",
  ).min(1, "Dosage is required."),
  frequency: consultationText(
    PRESCRIPTION_FREQUENCY_MAX_LENGTH,
    "Frequency",
  ).min(1, "Frequency is required."),
  duration: consultationText(
    PRESCRIPTION_DURATION_MAX_LENGTH,
    "Duration",
  ).min(1, "Duration is required."),
  instructions: consultationText(
    PRESCRIPTION_INSTRUCTIONS_MAX_LENGTH,
    "Instructions",
  )
    .nullable()
    .optional(),
});

export type PrescriptionItemInput = z.infer<typeof prescriptionItemSchema>;

/** Metadata for a file already uploaded through `/api/uploads/cloudinary`. */
export const consultationAttachmentSchema = z.object({
  fileName: z
    .string("File name is required.")
    .trim()
    .min(1, "File name is required.")
    .max(180, "File name is too long."),
  url: z
    .string("File URL is required.")
    .trim()
    .max(800, "File URL is too long.")
    .refine(
      (value) =>
        /^https:\/\/res\.cloudinary\.com\/[^/]+\/(?:image|raw)\/upload\//.test(
          value,
        ),
      "Upload a valid consultation file.",
    ),
  mimeType: z.enum(CONSULTATION_ATTACHMENT_MIME_TYPES, {
    message: "Only JPG, PNG, WebP, GIF or PDF files are supported.",
  }),
  size: z
    .number("File size is required.")
    .int("File size must be a whole number.")
    .positive("File size must be greater than zero.")
    .max(
      CONSULTATION_ATTACHMENT_MAX_BYTES,
      "Each file must be 10 MB or smaller.",
    ),
});

export type ConsultationAttachmentInput = z.infer<
  typeof consultationAttachmentSchema
>;

/**
 * Consultation upsert payload. The owning doctor may save partial progress
 * while the consultation is in progress - every field is optional, but at
 * least one piece of clinical content must be present.
 */
export const consultationUpsertSchema = z
  .object({
    notes: consultationText(
      CONSULTATION_NOTES_MAX_LENGTH,
      "Consultation notes",
    )
      .nullable()
      .optional(),
    diagnosis: consultationText(
      CONSULTATION_DIAGNOSIS_MAX_LENGTH,
      "Assessment / diagnosis",
    )
      .nullable()
      .optional(),
    treatmentAdvice: consultationText(
      CONSULTATION_TREATMENT_MAX_LENGTH,
      "Treatment advice",
    )
      .nullable()
      .optional(),
    followUp: consultationText(
      CONSULTATION_FOLLOW_UP_MAX_LENGTH,
      "Follow-up recommendation",
    )
      .nullable()
      .optional(),
    prescriptionItems: z
      .array(prescriptionItemSchema, "Check the prescription items.")
      .max(
        MAX_PRESCRIPTION_ITEMS,
        `A prescription can contain at most ${MAX_PRESCRIPTION_ITEMS} items.`,
      )
      .default([]),
    attachments: z
      .array(consultationAttachmentSchema, "Check the attached files.")
      .max(
        MAX_CONSULTATION_ATTACHMENTS,
        `Attach at most ${MAX_CONSULTATION_ATTACHMENTS} files.`,
      )
      .default([])
      .refine(
        (items) => new Set(items.map((item) => item.url)).size === items.length,
        "The same file cannot be attached twice.",
      ),
  })
  .refine(
    (value) =>
      Boolean(
        value.notes ||
          value.diagnosis ||
          value.treatmentAdvice ||
          value.followUp ||
          (value.prescriptionItems && value.prescriptionItems.length > 0) ||
          (value.attachments && value.attachments.length > 0),
      ),
    {
      message:
        "Add consultation notes, a diagnosis, advice, follow-up, a prescription item or an attached file.",
    },
  );

export type ConsultationUpsertInput = z.infer<typeof consultationUpsertSchema>;

/** Consultation list query parameters. */
export const consultationListQuerySchema = z.object({
  search: z.string().trim().max(120, "Search term is too long.").optional(),
  ...paginationSchema.shape,
});

export type ConsultationListQuery = z.infer<typeof consultationListQuerySchema>;
