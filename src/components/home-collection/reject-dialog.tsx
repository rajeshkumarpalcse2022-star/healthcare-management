"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { COLLECTION_NOTE_MAX_LENGTH } from "@/config/home-collection";

export interface CollectionRejectDialogProps {
  open: boolean;
  collectionCode: string;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  /** Invoked with the trimmed reason (always non-empty). */
  onConfirm: (reason: string) => void;
}

/**
 * Lab-manager rejection dialog. The reason is REQUIRED - the patient sees it
 * on their timeline, so the server also enforces a minimum length.
 */
export function CollectionRejectDialog({
  open,
  collectionCode,
  loading = false,
  error,
  onClose,
  onConfirm,
}: CollectionRejectDialogProps) {
  const [reason, setReason] = useState("");

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!loading) {
          setReason("");
          onClose();
        }
      }}
      title="Reject this request?"
      description={`Collection ${collectionCode} will be rejected and the reserved pickup slot released. The patient will see the reason you enter.`}
      size="sm"
      dismissible={!loading}
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => {
              setReason("");
              onClose();
            }}
            disabled={loading}
          >
            Keep request
          </Button>
          <Button
            variant="danger"
            loading={loading}
            disabled={reason.trim().length < 3}
            onClick={() => onConfirm(reason.trim())}
          >
            Reject request
          </Button>
        </>
      }
    >
      <Textarea
        label="Rejection reason (required)"
        name="collection-reject-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={COLLECTION_NOTE_MAX_LENGTH}
        error={error ?? undefined}
        placeholder="Why is this request being rejected?"
        hint="Shared with the patient on their request timeline."
      />
    </Modal>
  );
}
