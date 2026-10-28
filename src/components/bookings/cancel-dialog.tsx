"use client";

import { useState } from "react";

import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { BOOKING_NOTE_MAX_LENGTH } from "@/config/lab-bookings";

export interface CancelDialogProps {
  open: boolean;
  bookingCode: string;
  loading?: boolean;
  error?: string | null;
  onCancel: () => void;
  /** Invoked with the trimmed reason (empty string when left blank). */
  onConfirm: (reason: string) => void;
}

/**
 * Cancellation confirmation with an optional reason field.
 * Blocks interaction while `loading` so the request cannot fire twice.
 */
export function CancelDialog({
  open,
  bookingCode,
  loading = false,
  error,
  onCancel,
  onConfirm,
}: CancelDialogProps) {
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
      title="Cancel this booking?"
      description={`Booking ${bookingCode} will be cancelled and the reserved slot released. This cannot be undone.`}
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
            Keep booking
          </Button>
          <Button
            variant="danger"
            loading={loading}
            onClick={() => onConfirm(reason.trim())}
          >
            Cancel booking
          </Button>
        </>
      }
    >
      <Textarea
        label="Reason (optional)"
        name="cancellation-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={BOOKING_NOTE_MAX_LENGTH}
        error={error ?? undefined}
        placeholder="Why are you cancelling?"
        hint="Recorded with the booking for the laboratory's reference."
      />
    </Modal>
  );
}
