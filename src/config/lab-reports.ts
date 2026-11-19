export const LAB_REPORT_STATUSES = ["PUBLISHED"] as const;

export type LabReportStatus = (typeof LAB_REPORT_STATUSES)[number];

export const LAB_REPORT_STATUS_LABELS: Record<LabReportStatus, string> = {
  PUBLISHED: "Published",
};

export const LAB_REPORT_TITLE_MAX_LENGTH = 160;
export const LAB_REPORT_SUMMARY_MAX_LENGTH = 2_000;
export const LAB_REPORT_FINDINGS_MAX_LENGTH = 8_000;
export const LAB_REPORT_CONCLUSION_MAX_LENGTH = 3_000;

export const MAX_LAB_REPORT_ATTACHMENTS = 8;
export const LAB_REPORT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const LAB_REPORT_ATTACHMENT_FILE_NAME_MAX_LENGTH = 180;
export const LAB_REPORT_ATTACHMENT_URL_MAX_LENGTH = 800;
export const LAB_REPORT_ATTACHMENT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const;

export function formatLabReportCode(collectionCode: string): string {
  return /^HC-/.test(collectionCode)
    ? collectionCode.replace(/^HC-/, "RPT-")
    : `RPT-${collectionCode}`;
}
