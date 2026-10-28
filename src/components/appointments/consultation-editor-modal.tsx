"use client";

import * as React from "react";

import { IconPlus, IconTrash, IconUpload } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  CONSULTATION_ATTACHMENT_MAX_BYTES,
  CONSULTATION_ATTACHMENT_MIME_TYPES,
  CONSULTATION_DIAGNOSIS_MAX_LENGTH,
  CONSULTATION_FOLLOW_UP_MAX_LENGTH,
  CONSULTATION_NOTES_MAX_LENGTH,
  CONSULTATION_TREATMENT_MAX_LENGTH,
  MAX_CONSULTATION_ATTACHMENTS,
  MAX_PRESCRIPTION_ITEMS,
  PRESCRIPTION_DOSAGE_MAX_LENGTH,
  PRESCRIPTION_DURATION_MAX_LENGTH,
  PRESCRIPTION_FREQUENCY_MAX_LENGTH,
  PRESCRIPTION_INSTRUCTIONS_MAX_LENGTH,
  PRESCRIPTION_MEDICINE_MAX_LENGTH,
} from "@/config/appointments";
import { apiGet, apiSend, apiUpload, ApiRequestError } from "@/lib/api/client";
import type { ItemResponse } from "@/types/api";
import type {
  ConsultationAttachment,
  ConsultationRecordDto,
  PrescriptionItem,
} from "@/types/appointment";
import { issuesToErrors, type FieldErrors } from "./shared";

export interface ConsultationEditorModalProps {
  appointmentId: string;
  appointmentCode: string;
  /** Current record when one exists, `null` for the first write. */
  existing: ConsultationRecordDto | null;
  onClose: () => void;
  onSaved: () => void;
}

interface ItemDraft {
  medicine: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
}

function toDrafts(record: ConsultationRecordDto | null): ItemDraft[] {
  return (record?.prescriptionItems ?? []).map((item) => ({
    medicine: item.medicine,
    dosage: item.dosage,
    frequency: item.frequency,
    duration: item.duration,
    instructions: item.instructions ?? "",
  }));
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Doctor's consultation editor: notes, assessment, treatment advice,
 * follow-up and up to 20 prescription items, saved with `PUT
 * /api/appointments/[id]/consultation`.
 *
 * The server validates every field again and appends an audit entry for the
 * changed fields, so this form only enforces the shape needed for a good
 * first pass (required item fields, item cap) and surfaces server field
 * issues inline.
 */
export function ConsultationEditorModal({
  appointmentId,
  appointmentCode,
  existing,
  onClose,
  onSaved,
}: ConsultationEditorModalProps) {
  const [notes, setNotes] = React.useState(existing?.notes ?? "");
  const [diagnosis, setDiagnosis] = React.useState(existing?.diagnosis ?? "");
  const [treatmentAdvice, setTreatmentAdvice] = React.useState(
    existing?.treatmentAdvice ?? "",
  );
  const [followUp, setFollowUp] = React.useState(existing?.followUp ?? "");
  const [items, setItems] = React.useState<ItemDraft[]>(() => toDrafts(existing));
  const [attachments, setAttachments] = React.useState<ConsultationAttachment[]>(
    () => existing?.attachments ?? [],
  );
  const [uploadingAttachment, setUploadingAttachment] = React.useState(false);
  const [attachmentError, setAttachmentError] = React.useState<string | null>(
    null,
  );
  const attachmentInputRef = React.useRef<HTMLInputElement>(null);
  const [saving, setSaving] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});

  // The detail panel opens the editor without a loaded record; hydrate the
  // current record first so a save can never wipe existing clinical content.
  // A 404 simply means no record exists yet - the form starts blank. The
  // result is keyed so loading/error derive without effect-side resets.
  const [loadAttempt, setLoadAttempt] = React.useState(0);
  const loadKey = `${appointmentId}#${loadAttempt}`;
  const [loaded, setLoaded] = React.useState<{
    key: string;
    error: string | null;
  } | null>(null);

  React.useEffect(() => {
    if (existing !== null) return;
    let active = true;

    apiGet<ItemResponse<ConsultationRecordDto>>(
      `/api/appointments/${appointmentId}/consultation`,
    )
      .then((payload) => {
        if (!active) return;
        const record = payload.data;
        setNotes(record.notes ?? "");
        setDiagnosis(record.diagnosis ?? "");
        setTreatmentAdvice(record.treatmentAdvice ?? "");
        setFollowUp(record.followUp ?? "");
        setItems(toDrafts(record));
        setAttachments(record.attachments ?? []);
        setLoaded({ key: loadKey, error: null });
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        if (
          requestError instanceof ApiRequestError &&
          requestError.status === 404
        ) {
          setLoaded({ key: loadKey, error: null });
          return;
        }
        setLoaded({
          key: loadKey,
          error:
            requestError instanceof ApiRequestError
              ? requestError.message
              : "Unable to load the consultation record.",
        });
      });

    return () => {
      active = false;
    };
  }, [appointmentId, existing, loadKey]);

  const loadingRecord =
    existing === null && (loaded === null || loaded.key !== loadKey);
  const loadError =
    existing === null && loaded !== null && loaded.key === loadKey
      ? loaded.error
      : null;

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  }

  function removeItem(index: number) {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function handleAttachmentSelected(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setAttachmentError(null);

    if (
      !CONSULTATION_ATTACHMENT_MIME_TYPES.includes(
        file.type as (typeof CONSULTATION_ATTACHMENT_MIME_TYPES)[number],
      )
    ) {
      setAttachmentError("Only JPG, PNG, WebP, GIF or PDF files are supported.");
      return;
    }
    if (file.size > CONSULTATION_ATTACHMENT_MAX_BYTES) {
      setAttachmentError("Each file must be 10 MB or smaller.");
      return;
    }
    if (attachments.length >= MAX_CONSULTATION_ATTACHMENTS) {
      setAttachmentError(
        `Attach at most ${MAX_CONSULTATION_ATTACHMENTS} files to one record.`,
      );
      return;
    }

    setUploadingAttachment(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", "consultation");
      const result = await apiUpload<ItemResponse<{ url: string }>>(
        "/api/uploads/cloudinary",
        formData,
      );
      setAttachments((current) => [
        ...current,
        {
          fileName: file.name,
          url: result.data.url,
          mimeType: file.type,
          size: file.size,
          uploadedAt: new Date().toISOString(),
        },
      ]);
    } catch (error) {
      setAttachmentError(
        error instanceof ApiRequestError
          ? error.message
          : "Unable to upload the file. Please try again.",
      );
    } finally {
      setUploadingAttachment(false);
    }
  }

  function removeAttachment(url: string) {
    setAttachments((current) =>
      current.filter((attachment) => attachment.url !== url),
    );
    setAttachmentError(null);
  }

  async function handleSave() {
    if (saving || loadingRecord || loadError || uploadingAttachment) return;
    setFormError(null);
    setFieldErrors({});

    const filled = items.filter((item) =>
      [
        item.medicine,
        item.dosage,
        item.frequency,
        item.duration,
        item.instructions,
      ].some((value) => value.trim().length > 0),
    );
    const incomplete = filled.find(
      (item) =>
        !item.medicine.trim() ||
        !item.dosage.trim() ||
        !item.frequency.trim() ||
        !item.duration.trim(),
    );
    if (incomplete) {
      setFormError(
        "Fill in the medicine, dosage, frequency and duration for every prescription item, or remove the row.",
      );
      return;
    }

    const payload = {
      notes: notes.trim() || null,
      diagnosis: diagnosis.trim() || null,
      treatmentAdvice: treatmentAdvice.trim() || null,
      followUp: followUp.trim() || null,
      prescriptionItems: filled.map(
        (item): PrescriptionItem => ({
          medicine: item.medicine.trim(),
          dosage: item.dosage.trim(),
          frequency: item.frequency.trim(),
          duration: item.duration.trim(),
          instructions: item.instructions.trim() || null,
        }),
      ),
      attachments: attachments.map((attachment) => ({
        fileName: attachment.fileName,
        url: attachment.url,
        mimeType: attachment.mimeType,
        size: attachment.size,
      })),
    };

    setSaving(true);
    try {
      await apiSend<ItemResponse<ConsultationRecordDto>>(
        `/api/appointments/${appointmentId}/consultation`,
        "PUT",
        payload,
      );
      onSaved();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        const issues = issuesToErrors(error.issues);
        const next: FieldErrors = {};
        let banner: string | null = null;
        for (const [field, message] of Object.entries(issues)) {
          if (field === "prescriptionItems") {
            banner = message;
          } else if (
            field === "notes" ||
            field === "diagnosis" ||
            field === "treatmentAdvice" ||
            field === "followUp"
          ) {
            next[field] = message;
          } else if (!banner) {
            banner = message;
          }
        }
        setFieldErrors(next);
        setFormError(
          banner ?? (Object.keys(next).length === 0 ? error.message : null),
        );
      } else {
        setFormError("Unable to save the consultation record. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      onClose={() => {
        if (!saving) onClose();
      }}
      title={`Consultation record - ${appointmentCode}`}
      description="Record the diagnosis, treatment advice, prescription and optional scans. Changes are audited."
      size="xl"
      dismissible={!saving}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            loading={saving || loadingRecord}
            disabled={
              loadingRecord || Boolean(loadError) || uploadingAttachment
            }
            onClick={() => void handleSave()}
          >
            Save record
          </Button>
        </>
      }
    >
      {loadingRecord ? (
        <div className="flex flex-col gap-3" aria-hidden="true">
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : loadError ? (
        <ErrorState
          title="Unable to load the current record"
          description={loadError}
          onRetry={() => setLoadAttempt((value) => value + 1)}
        />
      ) : (
      <div className="flex flex-col gap-4">
        {formError ? (
          <p role="alert" className="form-error">
            {formError}
          </p>
        ) : null}

        <Textarea
          label="Consultation notes"
          name="consultation-notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={CONSULTATION_NOTES_MAX_LENGTH}
          error={fieldErrors.notes}
          placeholder="History, observations, vitals..."
          rows={3}
        />
        <Textarea
          label="Assessment / diagnosis"
          name="consultation-diagnosis"
          value={diagnosis}
          onChange={(event) => setDiagnosis(event.target.value)}
          maxLength={CONSULTATION_DIAGNOSIS_MAX_LENGTH}
          error={fieldErrors.diagnosis}
          placeholder="Working diagnosis or confirmed condition"
          rows={2}
        />
        <Textarea
          label="Treatment advice"
          name="consultation-treatment"
          value={treatmentAdvice}
          onChange={(event) => setTreatmentAdvice(event.target.value)}
          maxLength={CONSULTATION_TREATMENT_MAX_LENGTH}
          error={fieldErrors.treatmentAdvice}
          placeholder="Care plan, lifestyle advice, procedures performed"
          rows={3}
        />
        <Textarea
          label="Follow-up recommendation"
          name="consultation-follow-up"
          value={followUp}
          onChange={(event) => setFollowUp(event.target.value)}
          maxLength={CONSULTATION_FOLLOW_UP_MAX_LENGTH}
          error={fieldErrors.followUp}
          placeholder="When and why the patient should return"
          rows={2}
        />

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="form-label">Prescription</p>
              <p className="form-hint">
                {items.length} of {MAX_PRESCRIPTION_ITEMS} items. Save at least
                one piece of content overall.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={items.length >= MAX_PRESCRIPTION_ITEMS}
              onClick={() =>
                setItems((current) => [
                  ...current,
                  {
                    medicine: "",
                    dosage: "",
                    frequency: "",
                    duration: "",
                    instructions: "",
                  },
                ])
              }
            >
              <IconPlus className="size-4" />
              Add medicine
            </Button>
          </div>

          {items.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-ink-muted">
              No prescription items yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-3">
              {items.map((item, index) => (
                <li
                  key={index}
                  className="rounded-card border border-border p-3 sm:p-4"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
                      Item {index + 1}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeItem(index)}
                      aria-label={`Remove prescription item ${index + 1}`}
                    >
                      <IconTrash className="size-4" />
                      Remove
                    </Button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Input
                      label="Medicine"
                      name={`rx-medicine-${index}`}
                      value={item.medicine}
                      onChange={(event) =>
                        updateItem(index, { medicine: event.target.value })
                      }
                      maxLength={PRESCRIPTION_MEDICINE_MAX_LENGTH}
                      required
                    />
                    <Input
                      label="Dosage"
                      name={`rx-dosage-${index}`}
                      value={item.dosage}
                      onChange={(event) =>
                        updateItem(index, { dosage: event.target.value })
                      }
                      maxLength={PRESCRIPTION_DOSAGE_MAX_LENGTH}
                      placeholder="e.g. 500 mg"
                      required
                    />
                    <Input
                      label="Frequency"
                      name={`rx-frequency-${index}`}
                      value={item.frequency}
                      onChange={(event) =>
                        updateItem(index, { frequency: event.target.value })
                      }
                      maxLength={PRESCRIPTION_FREQUENCY_MAX_LENGTH}
                      placeholder="e.g. twice daily"
                      required
                    />
                    <Input
                      label="Duration"
                      name={`rx-duration-${index}`}
                      value={item.duration}
                      onChange={(event) =>
                        updateItem(index, { duration: event.target.value })
                      }
                      maxLength={PRESCRIPTION_DURATION_MAX_LENGTH}
                      placeholder="e.g. 5 days"
                      required
                    />
                    <Input
                      label="Instructions"
                      name={`rx-instructions-${index}`}
                      value={item.instructions}
                      onChange={(event) =>
                        updateItem(index, { instructions: event.target.value })
                      }
                      maxLength={PRESCRIPTION_INSTRUCTIONS_MAX_LENGTH}
                      placeholder="Optional, e.g. after meals"
                      containerClassName="sm:col-span-2"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="form-label">Scans, reports & prescriptions</p>
              <p className="form-hint">
                Optional. Attach patient scans, lab reports or a photographed
                prescription. {attachments.length} of{" "}
                {MAX_CONSULTATION_ATTACHMENTS} files.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              loading={uploadingAttachment}
              disabled={
                uploadingAttachment ||
                attachments.length >= MAX_CONSULTATION_ATTACHMENTS
              }
              onClick={() => attachmentInputRef.current?.click()}
            >
              <IconUpload className="size-4" />
              Add file
            </Button>
          </div>

          <input
            ref={attachmentInputRef}
            type="file"
            accept={CONSULTATION_ATTACHMENT_MIME_TYPES.join(",")}
            className="hidden"
            onChange={handleAttachmentSelected}
            disabled={uploadingAttachment}
          />

          {attachmentError ? (
            <p role="alert" className="form-error">
              {attachmentError}
            </p>
          ) : null}

          {attachments.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-ink-muted">
              No scans or prescriptions attached. This is optional.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {attachments.map((attachment) => (
                <li
                  key={attachment.url}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {attachment.fileName}
                    </p>
                    <p className="text-xs text-ink-subtle">
                      {formatFileSize(attachment.size)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={attachment.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-primary-hover underline-offset-4 hover:underline"
                    >
                      View
                    </a>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeAttachment(attachment.url)}
                      disabled={uploadingAttachment}
                      aria-label={`Remove ${attachment.fileName}`}
                    >
                      <IconTrash className="size-4" />
                      Remove
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      )}
    </Modal>
  );
}
