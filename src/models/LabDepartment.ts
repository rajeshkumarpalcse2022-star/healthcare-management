import { Schema, type HydratedDocument, type Types } from "mongoose";

import { getModel } from "@/lib/db";

/**
 * Lab department model - a functional unit inside one laboratory
 * (Hematology, Biochemistry, Microbiology, ...).
 *
 * Department records are database-owned; the suggestions list in
 * `@/config/labs` is UI guidance only and is never seeded as data.
 * The business code is unique within its laboratory.
 */
export interface LabDepartmentRecord {
  laboratoryId: Types.ObjectId;
  name: string;
  /** Business code, unique within `laboratoryId`. */
  code: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const labDepartmentSchema = new Schema<LabDepartmentRecord>(
  {
    laboratoryId: {
      type: Schema.Types.ObjectId,
      ref: "Laboratory",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 100,
    },
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 32,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 400,
      default: null,
      set: cleanText,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

/**
 * Indexes: department code must be unique inside its laboratory (compound
 * unique index); the remaining indexes cover listing and status filters.
 */
labDepartmentSchema.index({ laboratoryId: 1, code: 1 }, { unique: true });
labDepartmentSchema.index({ name: 1 });
labDepartmentSchema.index({ isActive: 1 });

export type LabDepartmentDocument = HydratedDocument<LabDepartmentRecord>;

/** Registered through the `getModel` helper (HMR-idempotent). */
export const LabDepartment = getModel<LabDepartmentRecord>(
  "LabDepartment",
  labDepartmentSchema,
);
