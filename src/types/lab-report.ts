import type { LabReportStatus } from "@/config/lab-reports";

export interface LabReportAttachmentDto {
  fileName: string;
  url: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

export interface LabReportInvoiceRef {
  id: string;
  invoiceCode: string;
  status: string;
  totalAmount: number;
}

export interface LabReportDto {
  id: string;
  reportCode: string;
  collectionId: string;
  collectionCode: string;
  patientId: string;
  patientName: string | null;
  laboratory: {
    id: string;
    name: string;
    code: string;
  } | null;
  invoice: LabReportInvoiceRef | null;
  title: string;
  summary: string | null;
  findings: string;
  conclusion: string | null;
  attachments: LabReportAttachmentDto[];
  reportDate: string;
  status: LabReportStatus;
  createdBy: {
    id: string;
    name: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface LabReportRef {
  id: string;
  reportCode: string;
  title: string;
  reportDate: string;
  status: LabReportStatus;
  attachments: LabReportAttachmentDto[];
  updatedAt: string;
}
