"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";
import { APPOINTMENT_REASON_MAX_LENGTH } from "@/config/appointments";

export interface AppointmentCancelDialogProps {
  open: boolean;
  appointmentCode: string;
  loading?: boolean;
  error?: string | null;
  onCancel: () => void;
  /** Invoked with the trimmed reason (empty string when left blank). */
  onConfirm: (reason: string) => void;
}

/**
 * Cancellation confirmation with an optional reason. Blocks interaction
 * while `loading` so the request cannot fire twice. Reason wording mirrors
 * the lab-booking dialog; the appointment slot is released by the server.
 */
export function AppointmentCancelDialog({
  open,
  appointmentCode,
  loading = false,
  error,
  onCancel,
  onConfirm,
}: AppointmentCancelDialogProps) {
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
      title="Cancel this appointment?"
      description={`Appointment ${appointmentCode} will be cancelled and the time slot released. This cannot be undone.`}
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
            Keep appointment
          </Button>
          <Button
            variant="danger"
            loading={loading}
            onClick={() => onConfirm(reason.trim())}
          >
            Cancel appointment
          </Button>
        </>
      }
    >
      <Textarea
        label="Reason (optional)"
        name="appointment-cancel-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={APPOINTMENT_REASON_MAX_LENGTH}
        error={error ?? undefined}
        placeholder="Why are you cancelling?"
        hint="Recorded with the appointment for the clinic's reference."
      />
    </Modal>
  );
}

export interface AppointmentRejectDialogProps {
  open: boolean;
  appointmentCode: string;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  /** Invoked with the trimmed reason (always at least 3 characters). */
  onConfirm: (reason: string) => void;
}

/**
 * Doctor rejection dialog for a pending request. The reason is REQUIRED -
 * the patient sees it on their appointment timeline, so the button stays
 * disabled until the server's minimum length is met.
 */
export function AppointmentRejectDialog({
  open,
  appointmentCode,
  loading = false,
  error,
  onClose,
  onConfirm,
}: AppointmentRejectDialogProps) {
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
      description={`Appointment ${appointmentCode} will be rejected and the time slot released. The patient will see the reason you enter.`}
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
        name="appointment-reject-reason"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={APPOINTMENT_REASON_MAX_LENGTH}
        error={error ?? undefined}
        placeholder="Why is this request being rejected?"
        hint="Shared with the patient on their appointment timeline."
      />
    </Modal>
  );
}
