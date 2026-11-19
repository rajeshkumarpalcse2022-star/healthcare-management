import type { LabReportStatus } from "@/config/lab-reports";
import type { LabReportDto, LabReportRef } from "@/types/lab-report";

interface ReportShape {
  _id: unknown;
  reportCode: string;
  collectionId: unknown;
  collectionCode: string;
  patientId: unknown;
  laboratoryId: unknown;
  invoiceId?: unknown;
  title: string;
  summary?: string | null;
  findings: string;
  conclusion?: string | null;
  attachments?: {
    fileName: string;
    url: string;
    mimeType: string;
    size: number;
    uploadedAt: Date | string;
  }[];
  reportDate: Date | string;
  status: string;
  createdBy?: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function iso(value: Date | string | null | undefined): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function refId(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object" && "_id" in (value as object)) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
}

function populatedName(value: unknown): string | null {
  if (value !== null && typeof value === "object" && "name" in value) {
    return String((value as { name: unknown }).name);
  }
  return null;
}

function toAttachments(
  attachments: ReportShape["attachments"],
): LabReportDto["attachments"] {
  return (attachments ?? []).map((attachment) => ({
    fileName: attachment.fileName,
    url: attachment.url,
    mimeType: attachment.mimeType,
    size: attachment.size,
    uploadedAt: iso(attachment.uploadedAt),
  }));
}

export function toLabReportRef(report: ReportShape): LabReportRef {
  return {
    id: String(report._id),
    reportCode: report.reportCode,
    title: report.title,
    reportDate: iso(report.reportDate),
    status: report.status as LabReportStatus,
    attachments: toAttachments(report.attachments),
    updatedAt: iso(report.updatedAt),
  };
}

export function toLabReportDto(report: ReportShape): LabReportDto {
  const lab = report.laboratoryId;
  const invoice = report.invoiceId;
  const creator = report.createdBy;

  return {
    id: String(report._id),
    reportCode: report.reportCode,
    collectionId: refId(report.collectionId) ?? "",
    collectionCode: report.collectionCode,
    patientId: refId(report.patientId) ?? "",
    patientName: populatedName(report.patientId),
    laboratory:
      lab !== null && typeof lab === "object" && "_id" in lab
        ? {
            id: String((lab as { _id: unknown })._id),
            name: String((lab as { name?: unknown }).name ?? ""),
            code: String((lab as { code?: unknown }).code ?? ""),
          }
        : null,
    invoice:
      invoice !== null &&
      invoice !== undefined &&
      typeof invoice === "object" &&
      "_id" in invoice
        ? {
            id: String((invoice as { _id: unknown })._id),
            invoiceCode: String(
              (invoice as { invoiceCode?: unknown }).invoiceCode ?? "",
            ),
            status: String((invoice as { status?: unknown }).status ?? ""),
            totalAmount: Number(
              (invoice as { totalAmount?: unknown }).totalAmount ?? 0,
            ),
          }
        : null,
    title: report.title,
    summary: report.summary ?? null,
    findings: report.findings,
    conclusion: report.conclusion ?? null,
    attachments: toAttachments(report.attachments),
    reportDate: iso(report.reportDate),
    status: report.status as LabReportStatus,
    createdBy:
      creator !== null &&
      creator !== undefined &&
      typeof creator === "object" &&
      "_id" in creator
        ? {
            id: String((creator as { _id: unknown })._id),
            name: String((creator as { name?: unknown }).name ?? ""),
          }
        : null,
    createdAt: iso(report.createdAt),
    updatedAt: iso(report.updatedAt),
  };
}
