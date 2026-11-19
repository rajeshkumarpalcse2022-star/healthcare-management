import { z } from "zod";

import {
  LAB_REPORT_ATTACHMENT_FILE_NAME_MAX_LENGTH,
  LAB_REPORT_ATTACHMENT_MAX_BYTES,
  LAB_REPORT_ATTACHMENT_MIME_TYPES,
  LAB_REPORT_ATTACHMENT_URL_MAX_LENGTH,
  LAB_REPORT_CONCLUSION_MAX_LENGTH,
  LAB_REPORT_FINDINGS_MAX_LENGTH,
  LAB_REPORT_SUMMARY_MAX_LENGTH,
  LAB_REPORT_TITLE_MAX_LENGTH,
  MAX_LAB_REPORT_ATTACHMENTS,
} from "@/config/lab-reports";
import { collectionDateStringSchema } from "./home-collection";
import { objectIdSchema, paginationSchema } from "./common";

const optionalLongText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .transform((value) => (value.length > 0 ? value : null))
    .nullable()
    .optional();

const reportFields = {
  title: z
    .string("Report title is required.")
    .trim()
    .min(3, "Report title must be at least 3 characters.")
    .max(
      LAB_REPORT_TITLE_MAX_LENGTH,
      `Report title must be ${LAB_REPORT_TITLE_MAX_LENGTH} characters or fewer.`,
    ),
  summary: optionalLongText(LAB_REPORT_SUMMARY_MAX_LENGTH, "Summary"),
  findings: z
    .string("Findings are required.")
    .trim()
    .min(10, "Findings must be at least 10 characters.")
    .max(
      LAB_REPORT_FINDINGS_MAX_LENGTH,
      `Findings must be ${LAB_REPORT_FINDINGS_MAX_LENGTH} characters or fewer.`,
    ),
  conclusion: optionalLongText(
    LAB_REPORT_CONCLUSION_MAX_LENGTH,
    "Conclusion",
  ),
  reportDate: collectionDateStringSchema,
};

export const labReportAttachmentSchema = z.object({
  fileName: z
    .string("File name is required.")
    .trim()
    .min(1, "File name is required.")
    .max(
      LAB_REPORT_ATTACHMENT_FILE_NAME_MAX_LENGTH,
      "File name is too long.",
    ),
  url: z
    .string("File URL is required.")
    .trim()
    .max(LAB_REPORT_ATTACHMENT_URL_MAX_LENGTH, "File URL is too long.")
    .refine(
      (value) =>
        /^https:\/\/res\.cloudinary\.com\/[^/]+\/(?:image|raw)\/upload\//.test(
          value,
        ),
      "Upload a valid lab report file.",
    ),
  mimeType: z.enum(LAB_REPORT_ATTACHMENT_MIME_TYPES, {
    message: "Only JPG, PNG, WebP, GIF or PDF files are supported.",
  }),
  size: z
    .number("File size is required.")
    .int("File size must be a whole number.")
    .positive("File size must be greater than zero.")
    .max(
      LAB_REPORT_ATTACHMENT_MAX_BYTES,
      "Each file must be 10 MB or smaller.",
    ),
});

export type LabReportAttachmentInput = z.infer<
  typeof labReportAttachmentSchema
>;

const attachmentsField = z
  .array(labReportAttachmentSchema, "Check the attached files.")
  .max(
    MAX_LAB_REPORT_ATTACHMENTS,
    `Attach at most ${MAX_LAB_REPORT_ATTACHMENTS} files.`,
  )
  .refine(
    (items) => new Set(items.map((item) => item.url)).size === items.length,
    "The same file cannot be attached twice.",
  );

export const labReportCreateSchema = z.object({
  collectionId: objectIdSchema,
  ...reportFields,
  attachments: attachmentsField.default([]),
});

export type LabReportCreateInput = z.infer<typeof labReportCreateSchema>;

export const labReportUpdateSchema = z.object({
  title: reportFields.title.optional(),
  summary: reportFields.summary,
  findings: reportFields.findings.optional(),
  conclusion: reportFields.conclusion,
  reportDate: reportFields.reportDate.optional(),
  attachments: attachmentsField.optional(),
});

export type LabReportUpdateInput = z.infer<typeof labReportUpdateSchema>;

export const labReportListQuerySchema = z.object({
  collectionId: objectIdSchema.optional(),
  patient: objectIdSchema.optional(),
  laboratory: objectIdSchema.optional(),
  ...paginationSchema.shape,
});

export type LabReportListQuery = z.infer<typeof labReportListQuerySchema>;

export const labReportIdSchema = z.object({
  id: objectIdSchema,
});
