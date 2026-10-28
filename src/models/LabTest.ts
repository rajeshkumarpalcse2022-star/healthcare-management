import { Schema, type HydratedDocument, type Types } from "mongoose";

import { getModel } from "@/lib/db";
import { SPECIMEN_TYPES, TEST_CATEGORIES } from "@/config/labs";

/**
 * Lab test model - a catalogue entry offered by one laboratory within one
 * department.
 *
 * The test code is unique within its laboratory. The department must belong
 * to the same laboratory as the test - enforced server-side on every write.
 * No patient / order data is referenced yet; that arrives with lab orders in
 * a later step.
 */
export interface LabTestRecord {
  laboratoryId: Types.ObjectId;
  departmentId: Types.ObjectId;
  name: string;
  /** Business code, unique within `laboratoryId`. */
  code: string;
  category: string;
  specimenType: string;
  methodology: string | null;
  turnaroundTimeMinutes: number;
  description: string | null;
  preparationInstructions: string | null;
  price: number;
  /**
   * Sample collection options. A test must offer at least one method; both
   * may be enabled. Defaults keep every pre-existing test bookable through
   * both channels until a lab manager narrows them.
   */
  labVisitEnabled: boolean;
  homeCollectionEnabled: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const labTestSchema = new Schema<LabTestRecord>(
  {
    laboratoryId: {
      type: Schema.Types.ObjectId,
      ref: "Laboratory",
      required: true,
    },
    departmentId: {
      type: Schema.Types.ObjectId,
      ref: "LabDepartment",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 160,
    },
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 32,
    },
    category: {
      type: String,
      required: true,
      enum: [...TEST_CATEGORIES],
      trim: true,
    },
    specimenType: {
      type: String,
      required: true,
      enum: [...SPECIMEN_TYPES],
      trim: true,
    },
    methodology: {
      type: String,
      trim: true,
      maxlength: 200,
      default: null,
      set: cleanText,
    },
    turnaroundTimeMinutes: {
      type: Number,
      required: true,
      min: 0,
      max: 43_200,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 1_000,
      default: null,
      set: cleanText,
    },
    preparationInstructions: {
      type: String,
      trim: true,
      maxlength: 1_000,
      default: null,
      set: cleanText,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
      max: 1_000_000,
    },
    labVisitEnabled: {
      type: Boolean,
      default: true,
    },
    homeCollectionEnabled: {
      type: Boolean,
      default: true,
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
 * At least one sample collection method must stay enabled. Documents stored
 * before these fields existed are treated as "both enabled" by reading
 * helpers; `runValidators` on a full-document save still enforces the rule
 * for new writes.
 */
labTestSchema.pre("validate", function (next) {
  if (!this.labVisitEnabled && !this.homeCollectionEnabled) {
    next(
      new Error(
        "Enable at least one sample collection method (lab visit or home collection).",
      ),
    );
    return;
  }
  next();
});

/**
 * Indexes: test code must be unique inside its laboratory (compound unique
 * index). The rest cover the directory filters.
 */
labTestSchema.index({ laboratoryId: 1, code: 1 }, { unique: true });
labTestSchema.index({ departmentId: 1 });
labTestSchema.index({ name: 1 });
labTestSchema.index({ category: 1 });
labTestSchema.index({ specimenType: 1 });
labTestSchema.index({ isActive: 1 });

export type LabTestDocument = HydratedDocument<LabTestRecord>;

/** Registered through the `getModel` helper (HMR-idempotent). */
export const LabTest = getModel<LabTestRecord>("LabTest", labTestSchema);
