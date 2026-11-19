import { Schema, type HydratedDocument, type Types } from "mongoose";

import {
  LAB_REPORT_ATTACHMENT_MAX_BYTES,
  LAB_REPORT_CONCLUSION_MAX_LENGTH,
  LAB_REPORT_FINDINGS_MAX_LENGTH,
  LAB_REPORT_STATUSES,
  LAB_REPORT_SUMMARY_MAX_LENGTH,
  LAB_REPORT_TITLE_MAX_LENGTH,
  MAX_LAB_REPORT_ATTACHMENTS,
} from "@/config/lab-reports";
import { getModel } from "@/lib/db";

export interface LabReportAttachmentRecord {
  fileName: string;
  url: string;
  mimeType: string;
  size: number;
  uploadedAt: Date;
}

export interface LabReportRecord {
  reportCode: string;
  collectionId: Types.ObjectId;
  collectionCode: string;
  patientId: Types.ObjectId;
  laboratoryId: Types.ObjectId;
  invoiceId: Types.ObjectId | null;
  title: string;
  summary: string | null;
  findings: string;
  conclusion: string | null;
  attachments: LabReportAttachmentRecord[];
  reportDate: Date;
  status: (typeof LAB_REPORT_STATUSES)[number];
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const attachmentSchema = new Schema<LabReportAttachmentRecord>(
  {
    fileName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    url: {
      type: String,
      required: true,
      trim: true,
      maxlength: 800,
    },
    mimeType: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    size: {
      type: Number,
      required: true,
      min: 1,
      max: LAB_REPORT_ATTACHMENT_MAX_BYTES,
    },
    uploadedAt: {
      type: Date,
      required: true,
    },
  },
  { _id: false },
);

const labReportSchema = new Schema<LabReportRecord>(
  {
    reportCode: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      maxlength: 32,
    },
    collectionId: {
      type: Schema.Types.ObjectId,
      ref: "HomeCollection",
      required: true,
    },
    collectionCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      maxlength: 32,
    },
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    laboratoryId: {
      type: Schema.Types.ObjectId,
      ref: "Laboratory",
      required: true,
    },
    invoiceId: {
      type: Schema.Types.ObjectId,
      ref: "Invoice",
      default: null,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: LAB_REPORT_TITLE_MAX_LENGTH,
    },
    summary: {
      type: String,
      trim: true,
      maxlength: LAB_REPORT_SUMMARY_MAX_LENGTH,
      default: null,
      set: cleanText,
    },
    findings: {
      type: String,
      required: true,
      trim: true,
      maxlength: LAB_REPORT_FINDINGS_MAX_LENGTH,
    },
    conclusion: {
      type: String,
      trim: true,
      maxlength: LAB_REPORT_CONCLUSION_MAX_LENGTH,
      default: null,
      set: cleanText,
    },
    attachments: {
      type: [attachmentSchema],
      default: [],
      validate: {
        validator: (value: LabReportAttachmentRecord[]) =>
          Array.isArray(value) && value.length <= MAX_LAB_REPORT_ATTACHMENTS,
        message: `A report can contain at most ${MAX_LAB_REPORT_ATTACHMENTS} attached files.`,
      },
    },
    reportDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: [...LAB_REPORT_STATUSES],
      default: "PUBLISHED",
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true },
);

labReportSchema.index({ collectionId: 1 }, { unique: true });
labReportSchema.index({ patientId: 1, createdAt: -1 });
labReportSchema.index({ laboratoryId: 1, createdAt: -1 });

export type LabReportDocument = HydratedDocument<LabReportRecord>;

export const LabReport = getModel<LabReportRecord>(
  "LabReport",
  labReportSchema,
);
