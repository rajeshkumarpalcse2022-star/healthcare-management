"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { COLLECTION_NOTE_MAX_LENGTH } from "@/config/home-collection";

export interface CollectionCancelDialogProps {
  open: boolean;
  collectionCode: string;
  loading?: boolean;
  error?: string | null;
  onCancel: () => void;
  /** Invoked with the trimmed reason (empty string when left blank). */
  onConfirm: (reason: string) => void;
}

/**
 * Collection cancellation confirmation with an optional reason.
 * Blocks interaction while `loading` so the request cannot fire twice.
 */
export function CollectionCancelDialog({
  open,
  collectionCode,
  loading = false,
  error,
  onCancel,
  onConfirm,
}: CollectionCancelDialogProps) {
  const [reason, setReason] = useState("");

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!loading) {
          setReason("");
          onCancel();
        }
      }}
      title="Cancel this collection?"
      description={`Collection ${collectionCode} will be cancelled and the reserved pickup slot released. This cannot be undone.`}
      size="sm"
      dismissible={!loading}
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => {
              setReason("");
              onCancel();
            }}
            disabled={loading}
          >
            Keep request
          </Button>
          <Button
            variant="danger"
            loading={loading}
            onClick={() => onConfirm(reason.trim())}
          >
            Cancel collection
          </Button>
        </>
      }
    >
      <Textarea
        label="Reason (optional)"
        name="collection-cancel-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={COLLECTION_NOTE_MAX_LENGTH}
        error={error ?? undefined}
        placeholder="Why are you cancelling?"
        hint="Recorded with the request for the laboratory's reference."
      />
    </Modal>
  );
}
