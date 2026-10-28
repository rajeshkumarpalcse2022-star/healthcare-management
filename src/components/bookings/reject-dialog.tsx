"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { BOOKING_NOTE_MAX_LENGTH } from "@/config/lab-bookings";

export interface BookingRejectDialogProps {
  open: boolean;
  bookingCode: string;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  /** Invoked with the trimmed reason (always non-empty). */
  onConfirm: (reason: string) => void;
}

/**
 * Lab-manager rejection dialog for a pending lab-visit request. The reason is
 * REQUIRED - the patient sees it on their booking timeline, so the server
 * enforces the same minimum length.
 */
export function BookingRejectDialog({
  open,
  bookingCode,
  loading = false,
  error,
  onClose,
  onConfirm,
}: BookingRejectDialogProps) {
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
      description={`Booking ${bookingCode} will be rejected and the reserved appointment slot released. The patient will see the reason you enter.`}
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
        name="booking-reject-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={BOOKING_NOTE_MAX_LENGTH}
        error={error ?? undefined}
        placeholder="Why is this request being rejected?"
        hint="Shared with the patient on their booking timeline."
      />
    </Modal>
  );
}
