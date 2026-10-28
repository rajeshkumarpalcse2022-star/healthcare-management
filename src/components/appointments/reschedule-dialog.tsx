"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils/cn";
import { apiGet, ApiRequestError } from "@/lib/api/client";
import type { ItemResponse } from "@/types/api";
import type {
  AppointmentAvailability,
  AppointmentSummary,
} from "@/types/appointment";
import { formatDateLabel } from "./shared";

export interface RescheduleDialogProps {
  open: boolean;
  appointment: AppointmentSummary;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  /** Invoked with the newly selected `YYYY-MM-DD` date and `HH:mm` slot. */
  onConfirm: (date: string, timeSlot: string) => void;
}

/**
 * Reschedule picker: choose a new date, load the doctor's live availability
 * for it and pick a free slot. Availability is always read from the server -
 * the dialog never derives bookability from stale client state - and the
 * submission is delegated to the caller, which claims the new slot before
 * releasing the old one.
 */
export function RescheduleDialog({
  open,
  appointment,
  loading = false,
  error,
  onClose,
  onConfirm,
}: RescheduleDialogProps) {
  const today = React.useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, []);

  const [attempt, setAttempt] = React.useState(0);
  const [date, setDate] = React.useState(appointment.date);
  const [selectedSlot, setSelectedSlot] = React.useState<string | null>(null);

  // Reset the picker when the dialog is (re)opened - render-phase state
  // derived from the `open` prop, so no effect-side reset is needed.
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDate(appointment.date);
      setSelectedSlot(null);
    }
  }

  const doctorId = appointment.doctor?.id ?? null;
  const clinicId = appointment.clinic?.id ?? null;
  const availKey = `${doctorId ?? "none"}|${clinicId ?? "none"}|${open ? date : ""}|${attempt}`;
  // Keyed availability result: loading and errors derive from the current
  // request key instead of being reset synchronously inside the effect.
  const [availResult, setAvailResult] = React.useState<{
    key: string;
    data: AppointmentAvailability | null;
    error: string | null;
  } | null>(null);

  React.useEffect(() => {
    if (!open || !doctorId || !clinicId) return;
    let active = true;

    apiGet<ItemResponse<AppointmentAvailability>>(
      `/api/appointments/availability?doctorId=${encodeURIComponent(doctorId)}&clinicId=${encodeURIComponent(clinicId)}&date=${encodeURIComponent(date)}`,
    )
      .then((payload) => {
        if (active) {
          setAvailResult({ key: availKey, data: payload.data, error: null });
        }
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        setAvailResult({
          key: availKey,
          data: null,
          error:
            requestError instanceof ApiRequestError
              ? requestError.message
              : "Unable to load available times. Please try again.",
        });
      });

    return () => {
      active = false;
    };
  }, [open, doctorId, clinicId, date, attempt, availKey]);

  const currentAvail =
    availResult !== null && availResult.key === availKey ? availResult : null;
  const availability = currentAvail?.data ?? null;
  const availabilityError = currentAvail?.error ?? null;
  const loadingAvailability =
    open &&
    doctorId !== null &&
    clinicId !== null &&
    date.length === 10 &&
    currentAvail === null;

  const schedule = availability?.schedule ?? null;
  const maxDate = React.useMemo(() => {
    if (!schedule) return null;
    const base = new Date(`${today}T00:00:00.000Z`);
    base.setUTCDate(base.getUTCDate() + schedule.maxAdvanceDays);
    return base.toISOString().slice(0, 10);
  }, [schedule, today]);

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!loading) onClose();
      }}
      title="Reschedule appointment"
      description={`Appointment ${appointment.appointmentCode} - pick a new date and time. The original slot is released once the new one is confirmed.`}
      dismissible={!loading}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Keep current time
          </Button>
          <Button
            loading={loading}
            disabled={!selectedSlot || loadingAvailability}
            onClick={() => {
              if (selectedSlot) onConfirm(date, selectedSlot);
            }}
          >
            Move appointment
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            label="New date"
            name="reschedule-date"
            type="date"
            value={date}
            min={today}
            max={maxDate ?? undefined}
            onChange={(event) => {
              setDate(event.target.value);
              setSelectedSlot(null);
            }}
            hint={
              schedule
                ? `Booking window: ${schedule.maxAdvanceDays} day(s) ahead.`
                : "Availability is checked against the doctor's schedule."
            }
          />
          <div className="flex items-end gap-2 text-sm text-ink-muted">
            <span>
              {date ? formatDateLabel(date) : "Select a date to see times."}
            </span>
          </div>
        </div>

        {availabilityError ? (
          <ErrorState
            title="Unable to load available times"
            description={availabilityError}
            onRetry={() => setAttempt((value) => value + 1)}
            className="py-4"
          />
        ) : loadingAvailability ? (
          <div
            className="grid grid-cols-2 gap-2 sm:grid-cols-4"
            aria-hidden="true"
          >
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-9 rounded-lg" />
            ))}
          </div>
        ) : availability && !availability.bookable ? (
          <p
            role="status"
            className="rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-ink-muted"
          >
            {availability.message ?? "This date has no bookable times."}
          </p>
        ) : availability && availability.slots.length === 0 ? (
          <p
            role="status"
            className="rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-ink-muted"
          >
            No slots are generated for this date.
          </p>
        ) : availability ? (
          <div className="flex flex-col gap-2">
            <p className="form-label">Available times</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {availability.slots.map((slot) => (
                <button
                  key={slot.start}
                  type="button"
                  disabled={!slot.available}
                  aria-pressed={selectedSlot === slot.start}
                  onClick={() => setSelectedSlot(slot.start)}
                  className={cn(
                    "rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                    "disabled:cursor-not-allowed",
                    selectedSlot === slot.start
                      ? "border-primary bg-primary text-white"
                      : slot.available
                        ? "border-border bg-surface text-ink hover:border-primary hover:text-primary"
                        : "border-border bg-surface-muted text-ink-subtle",
                  )}
                >
                  {slot.label}
                  {!slot.available ? (
                    <span className="ml-1 text-xs font-normal">Full</span>
                  ) : slot.remaining > 1 ? (
                    <span className="ml-1 text-xs font-normal">
                      {slot.remaining} seats
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="form-error">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
