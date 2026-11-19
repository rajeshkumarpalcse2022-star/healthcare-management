"use client";

import * as React from "react";

import {
  IconDownload,
  IconFlaskConical,
  IconPaperclip,
  IconTrash,
  IconUpload,
} from "@/components/icons";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button, buttonClasses } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import {
  LAB_REPORT_ATTACHMENT_MAX_BYTES,
  LAB_REPORT_ATTACHMENT_MIME_TYPES,
  MAX_LAB_REPORT_ATTACHMENTS,
} from "@/config/lab-reports";
import { ApiRequestError, apiSend, apiUpload } from "@/lib/api/client";
import type { ItemResponse } from "@/types/api";
import type { HomeCollectionInvoiceRef } from "@/types/home-collection";
import type {
  LabReportAttachmentDto,
  LabReportDto,
  LabReportRef,
} from "@/types/lab-report";
import { formatDateTime } from "./shared";

const INVOICE_BADGES: Record<string, BadgeVariant> = {
  DRAFT: "neutral",
  ISSUED: "info",
  PAID: "success",
  VOID: "danger",
};

export interface LabReportPanelProps {
  collectionId: string;
  collectionCode: string;
  report: LabReportRef | null | undefined;
  invoice: HomeCollectionInvoiceRef | null | undefined;
  canManage: boolean;
  onCreated: () => void;
}

function todayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${bytes} B`;
}

export function LabReportPanel({
  collectionId,
  collectionCode,
  report,
  invoice,
  canManage,
  onCreated,
}: LabReportPanelProps) {
  const toast = useToast();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState("");
  const [reportDate, setReportDate] = React.useState(todayString);
  const [summary, setSummary] = React.useState("");
  const [findings, setFindings] = React.useState("");
  const [conclusion, setConclusion] = React.useState("");
  const [attachments, setAttachments] = React.useState<
    LabReportAttachmentDto[]
  >([]);
  const [uploading, setUploading] = React.useState(false);
  const [attachmentError, setAttachmentError] = React.useState<string | null>(
    null,
  );
  const attachmentInputRef = React.useRef<HTMLInputElement>(null);

  function resetForm() {
    setTitle("");
    setReportDate(todayString());
    setSummary("");
    setFindings("");
    setConclusion("");
    setAttachments([]);
    setAttachmentError(null);
    setFormError(null);
  }

  async function handleFilesSelected(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    setAttachmentError(null);
    setUploading(true);
    try {
      let current = attachments;
      for (const file of files) {
        if (current.length >= MAX_LAB_REPORT_ATTACHMENTS) {
          setAttachmentError(
            `Attach at most ${MAX_LAB_REPORT_ATTACHMENTS} files to one report.`,
          );
          break;
        }
        if (
          !LAB_REPORT_ATTACHMENT_MIME_TYPES.includes(
            file.type as (typeof LAB_REPORT_ATTACHMENT_MIME_TYPES)[number],
          )
        ) {
          setAttachmentError(
            "Only JPG, PNG, WebP, GIF or PDF files are supported.",
          );
          continue;
        }
        if (file.size > LAB_REPORT_ATTACHMENT_MAX_BYTES) {
          setAttachmentError("Each file must be 10 MB or smaller.");
          continue;
        }

        const formData = new FormData();
        formData.append("file", file);
        formData.append("kind", "lab-report");
        const result = await apiUpload<ItemResponse<{ url: string }>>(
          "/api/uploads/cloudinary",
          formData,
        );
        const attachment: LabReportAttachmentDto = {
          fileName: file.name,
          url: result.data.url,
          mimeType: file.type,
          size: file.size,
          uploadedAt: new Date().toISOString(),
        };
        current = [...current, attachment];
        setAttachments(current);
      }
    } catch (error) {
      setAttachmentError(
        error instanceof ApiRequestError
          ? error.message
          : "Unable to upload the file. Please try again.",
      );
    } finally {
      setUploading(false);
    }
  }

  function removeAttachment(url: string) {
    setAttachments((current) =>
      current.filter((attachment) => attachment.url !== url),
    );
    setAttachmentError(null);
  }

  async function handleSubmit() {
    if (busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const result = await apiSend<ItemResponse<LabReportDto>>(
        "/api/lab-reports",
        "POST",
        {
          collectionId,
          title: title.trim(),
          reportDate,
          summary: summary.trim() || null,
          findings: findings.trim(),
          conclusion: conclusion.trim() || null,
          attachments: attachments.map((attachment) => ({
            fileName: attachment.fileName,
            url: attachment.url,
            mimeType: attachment.mimeType,
            size: attachment.size,
          })),
        },
      );
      toast.success(
        "Lab report published",
        result.data.invoice
          ? `${result.data.reportCode} and invoice ${result.data.invoice.invoiceCode} are ready to download.`
          : `${result.data.reportCode} is ready to download.`,
      );
      setOpen(false);
      resetForm();
      onCreated();
    } catch (error) {
      setFormError(
        error instanceof ApiRequestError
          ? error.issues?.[0]?.message ?? error.message
          : "Unable to publish the lab report. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  const hasReport = Boolean(report);
  const hasInvoice = Boolean(invoice);

  if (!hasReport && !hasInvoice && !canManage) {
    return null;
  }

  return (
    <>
      <Card className="mt-4">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Lab report & invoice</CardTitle>
              <p className="mt-1 text-sm text-ink-muted">
                Published reports and billing documents for{" "}
                {collectionCode}.
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasReport && report ? (
            <div className="rounded-control border border-border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <IconFlaskConical
                      className="size-4 text-primary"
                      aria-hidden="true"
                    />
                    <p className="font-mono text-xs uppercase tracking-wide text-ink-muted">
                      {report.reportCode}
                    </p>
                    <Badge variant="success" size="sm">
                      Published
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-ink">
                    {report.title}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    Report date {formatDateTime(report.reportDate)}
                  </p>
                  {report.attachments.length > 0 ? (
                    <ul className="mt-3 space-y-1.5">
                      {report.attachments.map((attachment) => (
                        <li key={attachment.url}>
                          <a
                            href={attachment.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                          >
                            <IconPaperclip
                              className="size-3.5"
                              aria-hidden="true"
                            />
                            {attachment.fileName}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`/api/lab-reports/${report.id}/pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={buttonClasses("outline", "sm")}
                  >
                    View report
                  </a>
                  <a
                    href={`/api/lab-reports/${report.id}/pdf`}
                    download={`${report.reportCode}.pdf`}
                    className={buttonClasses("secondary", "sm")}
                  >
                    <IconDownload className="size-4" />
                    Download report
                  </a>
                </div>
              </div>
            </div>
          ) : canManage ? (
            <div className="rounded-control border border-dashed border-border p-4 text-sm text-ink-muted">
              <p className="font-medium text-ink">Report not published yet</p>
              <p className="mt-1">
                Add the final findings and conclusion. An issued invoice is
                generated automatically with the report.
              </p>
              <Button className="mt-3" size="sm" onClick={() => setOpen(true)}>
                <IconUpload className="size-4" />
                Add lab report
              </Button>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">
              The laboratory report will appear here once it is published.
            </p>
          )}

          {hasInvoice && invoice ? (
            <div className="rounded-control border border-border bg-surface-muted p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-xs uppercase tracking-wide text-ink-muted">
                      {invoice.invoiceCode}
                    </p>
                    <Badge
                      variant={INVOICE_BADGES[invoice.status] ?? "neutral"}
                      size="sm"
                    >
                      {invoice.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm font-medium text-ink">
                    Invoice total{" "}
                    {new Intl.NumberFormat("en-IN", {
                      style: "currency",
                      currency: "INR",
                      maximumFractionDigits: 2,
                    }).format(invoice.totalAmount)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`/api/invoices/${invoice.id}/pdf`}
                    download={`${invoice.invoiceCode}.pdf`}
                    className={buttonClasses("outline", "sm")}
                  >
                    <IconDownload className="size-4" />
                    Download invoice
                  </a>
                  {canManage ? (
                    <a
                      href={`/billing/${invoice.id}`}
                      className={buttonClasses("ghost", "sm")}
                    >
                      Manage billing
                    </a>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add lab report"
        description="This report is published to the patient and is attached to the collection invoice."
        size="lg"
        dismissible={!busy}
        footer={
          <>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={
                busy ||
                uploading ||
                findings.trim().length < 10 ||
                title.trim().length < 3
              }
              loading={busy}
              onClick={() => void handleSubmit()}
            >
              {busy ? "Publishing…" : "Publish report"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError ? (
            <p className="form-error" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Report title"
              required
              value={title}
              maxLength={160}
              placeholder="Complete blood count report"
              onChange={(event) => setTitle(event.target.value)}
            />
            <Input
              label="Report date"
              type="date"
              required
              value={reportDate}
              onChange={(event) => setReportDate(event.target.value)}
            />
          </div>
          <Textarea
            label="Summary (optional)"
            rows={2}
            value={summary}
            maxLength={2000}
            hint="Short context shown at the top of the report."
            onChange={(event) => setSummary(event.target.value)}
          />
          <Textarea
            label="Findings / observations"
            required
            rows={6}
            value={findings}
            maxLength={8000}
            hint="Include test results, values, reference ranges and any observations."
            onChange={(event) => setFindings(event.target.value)}
          />
          <Textarea
            label="Conclusion / advice (optional)"
            rows={3}
            value={conclusion}
            maxLength={3000}
            onChange={(event) => setConclusion(event.target.value)}
          />

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="form-label">Supporting documents (optional)</p>
                <p className="form-hint">
                  Attach scanned reports, images or a PDF. The patient can view
                  and download these files from the report card.{" "}
                  {attachments.length} of {MAX_LAB_REPORT_ATTACHMENTS} files.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                loading={uploading}
                disabled={
                  uploading ||
                  attachments.length >= MAX_LAB_REPORT_ATTACHMENTS
                }
                onClick={() => attachmentInputRef.current?.click()}
              >
                <IconUpload className="size-4" />
                Add document
              </Button>
            </div>

            <input
              ref={attachmentInputRef}
              type="file"
              accept={LAB_REPORT_ATTACHMENT_MIME_TYPES.join(",")}
              multiple
              className="hidden"
              disabled={uploading}
              onChange={(event) => void handleFilesSelected(event)}
            />

            {attachmentError ? (
              <p role="alert" className="form-error">
                {attachmentError}
              </p>
            ) : null}

            {attachments.length > 0 ? (
              <ul className="space-y-2">
                {attachments.map((attachment) => (
                  <li
                    key={attachment.url}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border px-3 py-2.5"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <IconPaperclip
                        className="size-4 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-ink">
                          {attachment.fileName}
                        </p>
                        <p className="text-xs text-ink-subtle">
                          {formatFileSize(attachment.size)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <a
                        href={attachment.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        View
                      </a>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeAttachment(attachment.url)}
                      >
                        <IconTrash className="size-4" />
                        Remove
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-control border border-border bg-surface-muted px-3 py-2.5 text-sm text-ink-muted">
                No documents attached yet. This is optional.
              </p>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}
