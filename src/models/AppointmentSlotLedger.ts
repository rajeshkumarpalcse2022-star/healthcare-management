import { Schema, type HydratedDocument, type Types } from "mongoose";

import { getModel } from "@/lib/db";

/**
 * Slot capacity ledger - the concurrency guard for doctor appointments.
 *
 * One document per (doctor, calendar date, slot start) tracks how many
 * active appointments currently occupy that doctor's time. An appointment
 * claims capacity with a single atomic `findOneAndUpdate` guarded by
 * `taken < capacity` (see `src/lib/appointment/slots.ts`). Because MongoDB
 * executes that update atomically per document, two concurrent requests can
 * never both read the same count and both insert - the classic
 * check-then-insert race is closed without requiring replica-set
 * transactions. The capacity policy is always 1 across both appointment
 * types, so an online and a clinic visit can never double-book the same
 * doctor-time.
 *
 * Cancelled, rejected and rescheduled appointments release their hold
 * (`$inc` back down, floored at zero). The ledger is an operational
 * bookkeeping record - it is never used to display history (the Appointment
 * documents are).
 */
export interface AppointmentSlotLedgerRecord {
  doctorId: Types.ObjectId;
  /** Calendar date the slot belongs to (UTC midnight of that date). */
  appointmentDate: Date;
  /** Slot start in the doctor's timezone, `HH:mm`. */
  timeSlot: string;
  /** Number of capacity-holding appointments in this slot. */
  taken: number;
  createdAt: Date;
  updatedAt: Date;
}

const appointmentSlotLedgerSchema = new Schema<AppointmentSlotLedgerRecord>(
  {
    doctorId: {
      type: Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },
    appointmentDate: {
      type: Date,
      required: true,
    },
    timeSlot: {
      type: String,
      required: true,
      match: /^([01]\d|2[0-3]):[0-5]\d$/,
    },
    taken: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);

/**
 * Unique compound index doubles as the race arbiter: concurrent first
 * claims for the same slot produce exactly one insert; the loser receives a
 * duplicate-key error and retries against the now-existing document.
 */
appointmentSlotLedgerSchema.index(
  { doctorId: 1, appointmentDate: 1, timeSlot: 1 },
  { unique: true },
);

export type AppointmentSlotLedgerDocument =
  HydratedDocument<AppointmentSlotLedgerRecord>;

/** Registered through the `getModel` helper (HMR-idempotent). */
export const AppointmentSlotLedger = getModel<AppointmentSlotLedgerRecord>(
  "AppointmentSlotLedger",
  appointmentSlotLedgerSchema,
);
