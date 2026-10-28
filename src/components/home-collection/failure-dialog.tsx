"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { COLLECTION_FAILURE_REASON_MAX_LENGTH } from "@/config/home-collection";

export interface CollectionFailureDialogProps {
  open: boolean;
  collectionCode: string;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  /** Invoked with the trimmed, non-empty failure reason. */
  onConfirm: (reason: string) => void;
}

/**
 * Failed-pickup dialog. The reason is mandatory (the server rejects FAILED
 * without one) and recorded with the request for the audit history. A failed
 * pickup is terminal on this record - a retry creates a new request.
 */
export function CollectionFailureDialog({
  open,
  collectionCode,
  loading = false,
  error,
  onClose,
  onConfirm,
}: CollectionFailureDialogProps) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const empty = reason.trim().length === 0;
  const localError = touched && empty ? "A failure reason is required." : null;

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!loading) {
          setReason("");
          setTouched(false);
          onClose();
        }
      }}
      title="Record a failed pickup?"
      description={`Collection ${collectionCode} will be marked as failed. A reason is required and the reserved slot is released. A retry creates a new collection request.`}
      size="sm"
      dismissible={!loading}
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => {
              setReason("");
              setTouched(false);
              onClose();
            }}
            disabled={loading}
          >
            Keep collecting
          </Button>
          <Button
            variant="danger"
            loading={loading}
            onClick={() => {
              setTouched(true);
              const trimmed = reason.trim();
              if (trimmed.length > 0) onConfirm(trimmed);
            }}
          >
            Record failure
          </Button>
        </>
      }
    >
      <Textarea
        label="Failure reason (required)"
        name="collection-failure-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        onBlur={() => setTouched(true)}
        maxLength={COLLECTION_FAILURE_REASON_MAX_LENGTH}
        error={localError ?? error ?? undefined}
        placeholder="e.g. Address not found, no one home, sample not suitable"
        hint="Recorded with the request for the laboratory's reference."
      />
    </Modal>
  );
}
