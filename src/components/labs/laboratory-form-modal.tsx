"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import {
  DEFAULT_BOOKING_TIMEZONE,
  DEFAULT_CLOSING_TIME,
  DEFAULT_MAX_ADVANCE_DAYS,
  DEFAULT_OPERATING_DAYS,
  DEFAULT_OPENING_TIME,
  DEFAULT_SLOT_CAPACITY,
  DEFAULT_SLOT_DURATION_MINUTES,
  MAX_ADVANCE_DAYS_MAX,
  MAX_ADVANCE_DAYS_MIN,
  SLOT_CAPACITY_MAX,
  SLOT_CAPACITY_MIN,
  SLOT_DURATION_MINUTES_MAX,
  SLOT_DURATION_MINUTES_MIN,
  WEEKDAY_LABELS,
} from "@/config/lab-bookings";
import {
  DEFAULT_COLLECTION_CLOSING_TIME,
  DEFAULT_COLLECTION_MAX_ADVANCE_DAYS,
  DEFAULT_COLLECTION_OPERATING_DAYS,
  DEFAULT_COLLECTION_OPENING_TIME,
  DEFAULT_COLLECTION_SLOT_CAPACITY,
  DEFAULT_COLLECTION_SLOT_DURATION_MINUTES,
  DEFAULT_COLLECTION_TIMEZONE,
} from "@/config/home-collection";
import { apiSend, ApiRequestError } from "@/lib/api/client";
import {
  laboratoryCreateSchema,
  laboratoryUpdateSchema,
} from "@/lib/validation/laboratory";
import { toFieldIssues } from "@/lib/validation/common";
import type { ItemResponse } from "@/types/api";
import type { Laboratory } from "@/types/laboratory";
import type { FieldErrors } from "./shared";

interface LaboratoryFormValues {
  name: string;
  code: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  registrationNumber: string;
  accreditation: string;
}

/** Online-booking configuration as edited in the form (numbers as text). */
interface BookingConfigFormValues {
  enabled: boolean;
  timezone: string;
  operatingDays: number[];
  openingTime: string;
  closingTime: string;
  slotDurationMinutes: string;
  slotCapacity: string;
  maxAdvanceDays: string;
}

const EMPTY_VALUES: LaboratoryFormValues = {
  name: "",
  code: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  registrationNumber: "",
  accreditation: "",
};

const DEFAULT_BOOKING_VALUES: BookingConfigFormValues = {
  enabled: false,
  timezone: DEFAULT_BOOKING_TIMEZONE,
  operatingDays: [...DEFAULT_OPERATING_DAYS],
  openingTime: DEFAULT_OPENING_TIME,
  closingTime: DEFAULT_CLOSING_TIME,
  slotDurationMinutes: String(DEFAULT_SLOT_DURATION_MINUTES),
  slotCapacity: String(DEFAULT_SLOT_CAPACITY),
  maxAdvanceDays: String(DEFAULT_MAX_ADVANCE_DAYS),
};

function toFormValues(laboratory?: Laboratory | null): LaboratoryFormValues {
  if (!laboratory) return { ...EMPTY_VALUES };
  return {
    name: laboratory.name,
    code: laboratory.code,
    phone: laboratory.phone ?? "",
    email: laboratory.email ?? "",
    address: laboratory.address ?? "",
    city: laboratory.city ?? "",
    state: laboratory.state ?? "",
    pincode: laboratory.pincode ?? "",
    registrationNumber: laboratory.registrationNumber ?? "",
    accreditation: laboratory.accreditation ?? "",
  };
}

function toBookingFormValues(
  laboratory?: Laboratory | null,
): BookingConfigFormValues {
  const config = laboratory?.bookingConfig ?? null;
  if (!config) return { ...DEFAULT_BOOKING_VALUES };
  return {
    enabled: true,
    timezone: config.timezone,
    operatingDays: [...config.operatingDays],
    openingTime: config.openingTime,
    closingTime: config.closingTime,
    slotDurationMinutes: String(config.slotDurationMinutes),
    slotCapacity: String(config.slotCapacity),
    maxAdvanceDays: String(config.maxAdvanceDays),
  };
}

const DEFAULT_HOME_COLLECTION_VALUES: BookingConfigFormValues = {
  enabled: false,
  timezone: DEFAULT_COLLECTION_TIMEZONE,
  operatingDays: [...DEFAULT_COLLECTION_OPERATING_DAYS],
  openingTime: DEFAULT_COLLECTION_OPENING_TIME,
  closingTime: DEFAULT_COLLECTION_CLOSING_TIME,
  slotDurationMinutes: String(DEFAULT_COLLECTION_SLOT_DURATION_MINUTES),
  slotCapacity: String(DEFAULT_COLLECTION_SLOT_CAPACITY),
  maxAdvanceDays: String(DEFAULT_COLLECTION_MAX_ADVANCE_DAYS),
};

function toHomeCollectionFormValues(
  laboratory?: Laboratory | null,
): BookingConfigFormValues {
  const config = laboratory?.homeCollectionConfig ?? null;
  if (!config) return { ...DEFAULT_HOME_COLLECTION_VALUES };
  return {
    enabled: true,
    timezone: config.timezone,
    operatingDays: [...config.operatingDays],
    openingTime: config.openingTime,
    closingTime: config.closingTime,
    slotDurationMinutes: String(config.slotDurationMinutes),
    slotCapacity: String(config.slotCapacity),
    maxAdvanceDays: String(config.maxAdvanceDays),
  };
}

const BOOKING_PREFIX = "bookingConfig.";
const HOME_COLLECTION_PREFIX = "homeCollectionConfig.";

/** Splits merged schema issues into main / booking / collection errors. */
function splitIssues(
  issues: { field: string; message: string }[],
): { main: FieldErrors; booking: FieldErrors; homeCollection: FieldErrors } {
  const main: FieldErrors = {};
  const booking: FieldErrors = {};
  const homeCollection: FieldErrors = {};
  for (const issue of issues) {
    if (issue.field.startsWith(BOOKING_PREFIX)) {
      booking[issue.field.slice(BOOKING_PREFIX.length)] = issue.message;
    } else if (issue.field.startsWith(HOME_COLLECTION_PREFIX)) {
      homeCollection[issue.field.slice(HOME_COLLECTION_PREFIX.length)] =
        issue.message;
    } else {
      main[issue.field] = issue.message;
    }
  }
  return { main, booking, homeCollection };
}

export interface LaboratoryFormModalProps {
  open: boolean;
  onClose: () => void;
  /** `null` / omitted → create mode. */
  laboratory?: Laboratory | null;
  onSaved: (laboratory: Laboratory) => void;
}

/**
 * Create / edit laboratory dialog.
 *
 * Runs the shared Zod schema in the browser for instant feedback, then
 * re-validates on the server. The submit button locks while a request is in
 * flight so a double click cannot create a duplicate.
 */
export function LaboratoryFormModal({
  open,
  onClose,
  laboratory,
  onSaved,
}: LaboratoryFormModalProps) {
  const isEdit = Boolean(laboratory);
  const { success: showSuccess } = useToast();
  const [values, setValues] = React.useState<LaboratoryFormValues>(() =>
    toFormValues(laboratory),
  );
  const [booking, setBooking] = React.useState<BookingConfigFormValues>(() =>
    toBookingFormValues(laboratory),
  );
  const [homeCollection, setHomeCollection] =
    React.useState<BookingConfigFormValues>(() =>
      toHomeCollectionFormValues(laboratory),
    );
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [bookingErrors, setBookingErrors] = React.useState<FieldErrors>({});
  const [homeCollectionErrors, setHomeCollectionErrors] =
    React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Reset the form whenever the dialog opens. Render-phase adjustment keeps
  // stale values from the previous record from leaking into the next edit.
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setValues(toFormValues(laboratory));
      setBooking(toBookingFormValues(laboratory));
      setHomeCollection(toHomeCollectionFormValues(laboratory));
      setErrors({});
      setBookingErrors({});
      setHomeCollectionErrors({});
      setFormError(null);
      setSubmitting(false);
    }
  }

  function update<K extends keyof LaboratoryFormValues>(
    key: K,
    value: LaboratoryFormValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  }

  function updateBooking<K extends keyof BookingConfigFormValues>(
    key: K,
    value: BookingConfigFormValues[K],
  ) {
    setBooking((current) => ({ ...current, [key]: value }));
    setBookingErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  }

  function updateHomeCollection<K extends keyof BookingConfigFormValues>(
    key: K,
    value: BookingConfigFormValues[K],
  ) {
    setHomeCollection((current) => ({ ...current, [key]: value }));
    setHomeCollectionErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  }

  function toggleHomeCollectionDay(day: number) {
    setHomeCollection((current) => ({
      ...current,
      operatingDays: current.operatingDays.includes(day)
        ? current.operatingDays.filter((entry) => entry !== day)
        : [...current.operatingDays, day].sort((a, b) => a - b),
    }));
    setHomeCollectionErrors((current) => {
      if (!current.operatingDays) return current;
      const next = { ...current };
      delete next.operatingDays;
      return next;
    });
  }

  function toggleOperatingDay(day: number) {
    setBooking((current) => ({
      ...current,
      operatingDays: current.operatingDays.includes(day)
        ? current.operatingDays.filter((entry) => entry !== day)
        : [...current.operatingDays, day].sort((a, b) => a - b),
    }));
    setBookingErrors((current) => {
      if (!current.operatingDays) return current;
      const next = { ...current };
      delete next.operatingDays;
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const schema = isEdit ? laboratoryUpdateSchema : laboratoryCreateSchema;
    // Disabled → `null` clears an existing configuration on edit and is
    // simply omitted on create; enabled → validated config object.
    const bookingConfig = booking.enabled
      ? {
          timezone: booking.timezone,
          operatingDays: booking.operatingDays,
          openingTime: booking.openingTime,
          closingTime: booking.closingTime,
          slotDurationMinutes: Number(booking.slotDurationMinutes),
          slotCapacity: Number(booking.slotCapacity),
          maxAdvanceDays: Number(booking.maxAdvanceDays),
        }
      : isEdit
        ? null
        : undefined;
    const homeCollectionConfig = homeCollection.enabled
      ? {
          timezone: homeCollection.timezone,
          operatingDays: homeCollection.operatingDays,
          openingTime: homeCollection.openingTime,
          closingTime: homeCollection.closingTime,
          slotDurationMinutes: Number(homeCollection.slotDurationMinutes),
          slotCapacity: Number(homeCollection.slotCapacity),
          maxAdvanceDays: Number(homeCollection.maxAdvanceDays),
        }
      : isEdit
        ? null
        : undefined;
    const parsed = schema.safeParse({
      ...values,
      bookingConfig,
      homeCollectionConfig,
    });

    if (!parsed.success) {
      const split = splitIssues(toFieldIssues(parsed.error));
      setErrors(split.main);
      setBookingErrors(split.booking);
      setHomeCollectionErrors(split.homeCollection);
      setFormError(null);
      return;
    }

    setSubmitting(true);
    setErrors({});
    setBookingErrors({});
    setHomeCollectionErrors({});
    setFormError(null);

    try {
      const url = isEdit
        ? `/api/laboratories/${laboratory!.id}`
        : "/api/laboratories";
      const method = isEdit ? "PATCH" : "POST";
      const result = await apiSend<ItemResponse<Laboratory>>(
        url,
        method,
        parsed.data,
      );
      showSuccess(
        isEdit ? "Laboratory updated" : "Laboratory created",
        `${result.data.name} has been saved.`,
      );
      onSaved(result.data);
      onClose();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        const split = splitIssues(error.issues ?? []);
        setErrors(split.main);
        setBookingErrors(split.booking);
        setHomeCollectionErrors(split.homeCollection);
        setFormError(error.message);
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title={isEdit ? "Edit laboratory" : "Add laboratory"}
      description={
        isEdit
          ? "Update the laboratory details below."
          : "Register a new laboratory in the directory."
      }
      size="xl"
      dismissible={!submitting}
      footer={
        <>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="submit" form="laboratory-form" loading={submitting}>
            {isEdit ? "Save changes" : "Create laboratory"}
          </Button>
        </>
      }
    >
      <form id="laboratory-form" onSubmit={handleSubmit} noValidate>
        {formError ? (
          <div
            role="alert"
            className="mb-4 rounded-control border border-danger-line bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
          >
            {formError}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Laboratory name"
            name="name"
            required
            autoComplete="organization"
            value={values.name}
            onChange={(event) => update("name", event.target.value)}
            error={errors.name}
            containerClassName="sm:col-span-2"
            placeholder="e.g. Central Diagnostics Lab"
          />

          <Input
            label="Laboratory code"
            name="code"
            required
            value={values.code}
            onChange={(event) => update("code", event.target.value)}
            error={errors.code}
            hint="Unique business code, e.g. LAB-01"
            placeholder="LAB-01"
          />

          <Input
            label="Accreditation"
            name="accreditation"
            value={values.accreditation}
            onChange={(event) => update("accreditation", event.target.value)}
            error={errors.accreditation}
            placeholder="e.g. NABL, CAP (optional)"
          />

          <Input
            label="Phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            value={values.phone}
            onChange={(event) => update("phone", event.target.value)}
            error={errors.phone}
            placeholder="+91 98765 43210"
          />

          <Input
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            value={values.email}
            onChange={(event) => update("email", event.target.value)}
            error={errors.email}
            placeholder="lab@example.com"
          />

          <Input
            label="City"
            name="city"
            autoComplete="address-level2"
            value={values.city}
            onChange={(event) => update("city", event.target.value)}
            error={errors.city}
          />

          <Input
            label="State"
            name="state"
            autoComplete="address-level1"
            value={values.state}
            onChange={(event) => update("state", event.target.value)}
            error={errors.state}
          />

          <Input
            label="Pincode"
            name="pincode"
            autoComplete="postal-code"
            value={values.pincode}
            onChange={(event) => update("pincode", event.target.value)}
            error={errors.pincode}
          />

          <Input
            label="Registration number"
            name="registrationNumber"
            value={values.registrationNumber}
            onChange={(event) =>
              update("registrationNumber", event.target.value)
            }
            error={errors.registrationNumber}
            placeholder="Optional"
          />

          <Textarea
            label="Address"
            name="address"
            autoComplete="street-address"
            value={values.address}
            onChange={(event) => update("address", event.target.value)}
            error={errors.address}
            containerClassName="sm:col-span-2"
            placeholder="Street, area, landmark"
          />
        </div>

        {/* Online booking configuration (STEP 7) */}
        <div className="mt-6 border-t border-border pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">Online booking</p>
              <p className="mt-0.5 text-xs text-ink-muted">
                Working hours, slot duration and capacity used to generate
                bookable time slots.
              </p>
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm font-medium text-ink">
              <input
                type="checkbox"
                name="booking-enabled"
                checked={booking.enabled}
                onChange={(event) =>
                  updateBooking("enabled", event.target.checked)
                }
                className="size-4 accent-[#10B981]"
              />
              Accept online bookings
            </label>
          </div>

          {booking.enabled ? (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Timezone"
                name="booking-timezone"
                value={booking.timezone}
                onChange={(event) => updateBooking("timezone", event.target.value)}
                error={bookingErrors.timezone}
                hint="IANA timezone used for slot times, e.g. Asia/Kolkata"
                placeholder="Asia/Kolkata"
              />

              <div className="sm:col-span-2">
                <fieldset>
                  <legend className="text-sm font-medium text-ink">
                    Operating days
                  </legend>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {WEEKDAY_LABELS.map((label, day) => {
                      const selected = booking.operatingDays.includes(day);
                      return (
                        <button
                          key={label}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggleOperatingDay(day)}
                          className={
                            selected
                              ? "rounded-md border border-primary bg-primary px-2.5 py-1.5 text-xs font-medium text-white"
                              : "rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-muted"
                          }
                        >
                          {label.slice(0, 3)}
                        </button>
                      );
                    })}
                  </div>
                  {bookingErrors.operatingDays ? (
                    <p role="alert" className="mt-1.5 text-xs text-danger">
                      {bookingErrors.operatingDays}
                    </p>
                  ) : null}
                </fieldset>
              </div>

              <Input
                label="Opening time"
                name="booking-opening-time"
                type="time"
                value={booking.openingTime}
                onChange={(event) =>
                  updateBooking("openingTime", event.target.value)
                }
                error={bookingErrors.openingTime}
              />

              <Input
                label="Closing time"
                name="booking-closing-time"
                type="time"
                value={booking.closingTime}
                onChange={(event) =>
                  updateBooking("closingTime", event.target.value)
                }
                error={bookingErrors.closingTime}
              />

              <Input
                label="Slot duration (minutes)"
                name="booking-slot-duration"
                type="number"
                inputMode="numeric"
                min={SLOT_DURATION_MINUTES_MIN}
                max={SLOT_DURATION_MINUTES_MAX}
                value={booking.slotDurationMinutes}
                onChange={(event) =>
                  updateBooking("slotDurationMinutes", event.target.value)
                }
                error={bookingErrors.slotDurationMinutes}
                hint={`${SLOT_DURATION_MINUTES_MIN}–${SLOT_DURATION_MINUTES_MAX} minutes`}
              />

              <Input
                label="Bookings per slot"
                name="booking-slot-capacity"
                type="number"
                inputMode="numeric"
                min={SLOT_CAPACITY_MIN}
                max={SLOT_CAPACITY_MAX}
                value={booking.slotCapacity}
                onChange={(event) =>
                  updateBooking("slotCapacity", event.target.value)
                }
                error={bookingErrors.slotCapacity}
                hint={`${SLOT_CAPACITY_MIN}–${SLOT_CAPACITY_MAX} simultaneous bookings`}
              />

              <Input
                label="Advance booking window (days)"
                name="booking-max-advance-days"
                type="number"
                inputMode="numeric"
                min={MAX_ADVANCE_DAYS_MIN}
                max={MAX_ADVANCE_DAYS_MAX}
                value={booking.maxAdvanceDays}
                onChange={(event) =>
                  updateBooking("maxAdvanceDays", event.target.value)
                }
                error={bookingErrors.maxAdvanceDays}
                hint={`How far ahead patients may book (${MAX_ADVANCE_DAYS_MIN}–${MAX_ADVANCE_DAYS_MAX} days)`}
              />
            </div>
          ) : (
            <p className="mt-3 text-xs text-ink-subtle">
              Online booking is turned off for this laboratory. Availability
              queries report it as not configured until a schedule is saved.
            </p>
          )}
        </div>

        {/* Home sample collection configuration (STEP 8) */}
        <div className="mt-6 border-t border-border pt-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                Home sample collection
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">
                Pickup hours, visit duration and per-slot collector capacity
                for home collection requests.
              </p>
            </div>
            <label className="flex shrink-0 cursor-pointer items-center gap-2 text-sm font-medium text-ink">
              <input
                type="checkbox"
                name="home-collection-enabled"
                checked={homeCollection.enabled}
                onChange={(event) =>
                  updateHomeCollection("enabled", event.target.checked)
                }
                className="size-4 accent-[#10B981]"
              />
              Accept home collections
            </label>
          </div>

          {homeCollection.enabled ? (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Timezone"
                name="home-collection-timezone"
                value={homeCollection.timezone}
                onChange={(event) =>
                  updateHomeCollection("timezone", event.target.value)
                }
                error={homeCollectionErrors.timezone}
                hint="IANA timezone used for pickup times, e.g. Asia/Kolkata"
                placeholder="Asia/Kolkata"
              />

              <div className="sm:col-span-2">
                <fieldset>
                  <legend className="text-sm font-medium text-ink">
                    Pickup days
                  </legend>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {WEEKDAY_LABELS.map((label, day) => {
                      const selected =
                        homeCollection.operatingDays.includes(day);
                      return (
                        <button
                          key={label}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => toggleHomeCollectionDay(day)}
                          className={
                            selected
                              ? "rounded-md border border-primary bg-primary px-2.5 py-1.5 text-xs font-medium text-white"
                              : "rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-muted"
                          }
                        >
                          {label.slice(0, 3)}
                        </button>
                      );
                    })}
                  </div>
                  {homeCollectionErrors.operatingDays ? (
                    <p role="alert" className="mt-1.5 text-xs text-danger">
                      {homeCollectionErrors.operatingDays}
                    </p>
                  ) : null}
                </fieldset>
              </div>

              <Input
                label="Pickup window opens"
                name="home-collection-opening-time"
                type="time"
                value={homeCollection.openingTime}
                onChange={(event) =>
                  updateHomeCollection("openingTime", event.target.value)
                }
                error={homeCollectionErrors.openingTime}
              />

              <Input
                label="Pickup window closes"
                name="home-collection-closing-time"
                type="time"
                value={homeCollection.closingTime}
                onChange={(event) =>
                  updateHomeCollection("closingTime", event.target.value)
                }
                error={homeCollectionErrors.closingTime}
              />

              <Input
                label="Visit duration (minutes)"
                name="home-collection-slot-duration"
                type="number"
                inputMode="numeric"
                min={SLOT_DURATION_MINUTES_MIN}
                max={SLOT_DURATION_MINUTES_MAX}
                value={homeCollection.slotDurationMinutes}
                onChange={(event) =>
                  updateHomeCollection("slotDurationMinutes", event.target.value)
                }
                error={homeCollectionErrors.slotDurationMinutes}
                hint={`${SLOT_DURATION_MINUTES_MIN}–${SLOT_DURATION_MINUTES_MAX} minutes`}
              />

              <Input
                label="Collections per slot"
                name="home-collection-slot-capacity"
                type="number"
                inputMode="numeric"
                min={SLOT_CAPACITY_MIN}
                max={SLOT_CAPACITY_MAX}
                value={homeCollection.slotCapacity}
                onChange={(event) =>
                  updateHomeCollection("slotCapacity", event.target.value)
                }
                error={homeCollectionErrors.slotCapacity}
                hint={`${SLOT_CAPACITY_MIN}–${SLOT_CAPACITY_MAX} simultaneous pickups`}
              />

              <Input
                label="Advance request window (days)"
                name="home-collection-max-advance-days"
                type="number"
                inputMode="numeric"
                min={MAX_ADVANCE_DAYS_MIN}
                max={MAX_ADVANCE_DAYS_MAX}
                value={homeCollection.maxAdvanceDays}
                onChange={(event) =>
                  updateHomeCollection("maxAdvanceDays", event.target.value)
                }
                error={homeCollectionErrors.maxAdvanceDays}
                hint={`How far ahead patients may request pickup (${MAX_ADVANCE_DAYS_MIN}–${MAX_ADVANCE_DAYS_MAX} days)`}
              />
            </div>
          ) : (
            <p className="mt-3 text-xs text-ink-subtle">
              Home collection is turned off for this laboratory. Availability
              queries report it as not enabled until a schedule is saved.
            </p>
          )}
        </div>
      </form>
    </Modal>
  );
}
