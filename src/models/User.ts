import { Schema, type HydratedDocument } from "mongoose";

import { ROLE_VALUES, type Role } from "@/config/roles";
import { getModel } from "@/lib/db";

/**
 * User model - authentication and identity foundation.
 *
 * Only identity fields live here; business data (patients, labs, billing ...)
 * belongs to later steps. Passwords are stored exclusively as bcrypt hashes
 * (`select: false` keeps the hash out of default query results entirely).
 */
export interface UserRecord {
  name: string;
  /** Normalised (trimmed + lowercased) and unique. */
  email: string;
  phone: string | null;
  /** bcrypt hash - never a plain-text password. */
  passwordHash: string;
  role: Role;
  isActive: boolean;
  /**
   * Laboratory assignments for scoped operational roles (LAB_MANAGER/STAFF).
   *
   * - absent  -> legacy platform-wide account (visibility is never
   *   backfilled automatically; scoping happens only through the explicit
   *   assignment API);
   * - `[]`    -> scoped to no laboratory at all (the value NEW LM/STAFF
   *   provisioning writes);
   * - `[ids]` -> restricted to exactly these laboratories.
   *
   * Deliberately optional with NO schema default: a `default: []` would
   * make Mongoose hydrate legacy documents (field absent in MongoDB) as
   * `[]`, silently converting platform-wide accounts into "sees nothing".
   */
  laboratoryIds?: string[];
  /**
   * Embedded audit trail of laboratory-scope assignments (newest first,
   * capped). Who assigned what, when - stays on the user record so scope
   * changes never need a side collection. Absent on legacy accounts.
   */
  laboratoryScopeHistory?: LaboratoryScopeChange[];
  createdAt: Date;
  updatedAt: Date;
}

/** One recorded laboratory-scope assignment change. */
export interface LaboratoryScopeChange {
  /** Scope applied by this change. */
  laboratoryIds: string[];
  /** Scope in effect before this change (empty for platform-wide -> scoped). */
  previousLaboratoryIds: string[];
  /** User id of the SUPER_ADMIN/ADMIN who made the change. */
  changedBy: string;
  changedAt: Date;
}

const userSchema = new Schema<UserRecord>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    phone: {
      type: String,
      trim: true,
      maxlength: 20,
      default: null,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ROLE_VALUES,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    laboratoryIds: {
      type: [String],
      default: undefined,
      // `default: undefined` is REQUIRED, not optional: Mongoose applies an
      // implicit `[]` default to array paths on hydration, which would make
      // a legacy account (field absent in the DB) read back as explicitly
      // scoped to nothing. With `undefined` the path truly stays absent, so
      // `toSafeUser` omits it and the account remains platform-wide (D4).
    },
    laboratoryScopeHistory: {
      type: [
        {
          _id: false,
          laboratoryIds: { type: [String], required: true },
          previousLaboratoryIds: { type: [String], required: true },
          changedBy: { type: String, required: true },
          changedAt: { type: Date, required: true },
        },
      ],
      // Same reason as above: absent stays absent until the first `$push`,
      // which creates the array on the record itself.
      default: undefined,
    },
  },
  {
    timestamps: true,
  },
);

/** Multikey index so scoped list queries filter by laboratory cheaply. */
userSchema.index({ laboratoryIds: 1 });

export type UserDocument = HydratedDocument<UserRecord>;

/** Registered through the STEP 2 `getModel` helper (HMR-idempotent). */
export const User = getModel<UserRecord>("User", userSchema);
