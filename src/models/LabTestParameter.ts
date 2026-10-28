import { Schema, type HydratedDocument, type Types } from "mongoose";

import { getModel } from "@/lib/db";
import { PARAMETER_DATA_TYPES } from "@/config/labs";

/**
 * Lab test parameter model - a single measurable property of a lab test
 * (e.g. Hemoglobin within CBC).
 *
 * The structured reference range (`low` / `high` / `text`) plus critical
 * bounds give a later result-entry step enough information to validate
 * patient results without new schema work. No patient results live here.
 */
export interface LabTestParameterReferenceRange {
  low: number | null;
  high: number | null;
  text: string | null;
}

export interface LabTestParameterRecord {
  labTestId: Types.ObjectId;
  name: string;
  code: string;
  dataType: (typeof PARAMETER_DATA_TYPES)[number];
  unit: string | null;
  referenceRange: LabTestParameterReferenceRange;
  criticalLow: number | null;
  criticalHigh: number | null;
  displayOrder: number;
  isRequired: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const labTestParameterSchema = new Schema<LabTestParameterRecord>(
  {
    labTestId: {
      type: Schema.Types.ObjectId,
      ref: "LabTest",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 120,
    },
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 32,
    },
    dataType: {
      type: String,
      required: true,
      enum: [...PARAMETER_DATA_TYPES],
    },
    unit: {
      type: String,
      trim: true,
      maxlength: 40,
      default: null,
      set: cleanText,
    },
    referenceRange: {
      type: {
        low: { type: Number, default: null },
        high: { type: Number, default: null },
        text: { type: String, trim: true, maxlength: 160, default: null },
      },
      _id: false,
      default: () => ({ low: null, high: null, text: null }),
    },
    criticalLow: {
      type: Number,
      default: null,
    },
    criticalHigh: {
      type: Number,
      default: null,
    },
    displayOrder: {
      type: Number,
      required: true,
      min: 1,
      max: 999,
    },
    isRequired: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

/**
 * Indexes: parameter code is unique within its lab test (compound unique),
 * and the ordered listing for a test is served by `{ labTestId, displayOrder }`.
 */
labTestParameterSchema.index({ labTestId: 1, code: 1 }, { unique: true });
labTestParameterSchema.index({ labTestId: 1, displayOrder: 1 });

export type LabTestParameterDocument = HydratedDocument<LabTestParameterRecord>;

/** Registered through the `getModel` helper (HMR-idempotent). */
export const LabTestParameter = getModel<LabTestParameterRecord>(
  "LabTestParameter",
  labTestParameterSchema,
);
