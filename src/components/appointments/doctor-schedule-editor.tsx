"use client";

import * as React from "react";

import {
  IconAlertTriangle,
  IconPlus,
  IconTrash,
} from "@/components/icons";
import { ConfirmDialog } from "@/components/bookings/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  APPOINTMENT_MAX_ADVANCE_DAYS_MAX,
  APPOINTMENT_MAX_ADVANCE_DAYS_MIN,
  APPOINTMENT_MAX_BREAKS,
  APPOINTMENT_MAX_DATE_OVERRIDES,
  APPOINTMENT_MAX_UNAVAILABLE_DATES,
  APPOINTMENT_SLOT_CAPACITY_MAX,
  APPOINTMENT_SLOT_CAPACITY_MIN,
  APPOINTMENT_SLOT_DURATION_MINUTES_MAX,
  APPOINTMENT_SLOT_DURATION_MINUTES_MIN,
  DEFAULT_APPOINTMENT_CLOSING_TIME,
  DEFAULT_APPOINTMENT_MAX_ADVANCE_DAYS,
  DEFAULT_APPOINTMENT_OPENING_TIME,
  DEFAULT_APPOINTMENT_OPERATING_DAYS,
  DEFAULT_APPOINTMENT_SLOT_CAPACITY,
  DEFAULT_APPOINTMENT_SLOT_DURATION_MINUTES,
  DEFAULT_APPOINTMENT_TIMEZONE,
} from "@/config/appointments";
import { apiSend, ApiRequestError } from "@/lib/api/client";
import { findScheduleConflict } from "@/lib/appointment/schedule-conflicts";
import { localDateString } from "@/lib/utils/dashboard-rows";
import type { ItemResponse } from "@/types/api";
import type {
  DoctorClinicScheduleOption,
  DoctorScheduleBreak,
  DoctorScheduleConfig,
  DoctorScheduleDateOverride,
} from "@/types/appointment";
import { issuesToErrors, type FieldErrors } from "./shared";

const WEEKDAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

const TIMEZONE_SUGGESTIONS = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Europe/London",
  "America/New_York",
  "America/Los_Angeles",
  "Australia/Sydney",
];

interface BreakDraft {
  start: string;
  end: string;
}

export interface DoctorScheduleEditorProps {
  doctorId: string;
  clinics: DoctorClinicScheduleOption[];
  initialClinicId: string;
}

interface ClinicScheduleFormProps {
  doctorId: string;
  clinic: DoctorClinicScheduleOption;
  initialConfig: DoctorScheduleConfig | null;
  otherClinics: {
    clinicId: string;
    clinicName: string;
    schedule: DoctorScheduleConfig | null;
  }[];
  onSaved: (clinicId: string, config: DoctorScheduleConfig | null) => void;
}

function toBreakDrafts(breaks: DoctorScheduleBreak[] | undefined): BreakDraft[] {
  return (breaks ?? []).map((entry) => ({ ...entry }));
}

function ClinicScheduleForm({
  doctorId,
  clinic,
  initialConfig,
  otherClinics,
  onSaved,
}: ClinicScheduleFormProps) {
  const [configured, setConfigured] = React.useState(initialConfig !== null);
  const [timezone, setTimezone] = React.useState(
    initialConfig?.timezone ?? DEFAULT_APPOINTMENT_TIMEZONE,
  );
  const [operatingDays, setOperatingDays] = React.useState<number[]>(
    initialConfig?.operatingDays ?? [...DEFAULT_APPOINTMENT_OPERATING_DAYS],
  );
  const [openingTime, setOpeningTime] = React.useState(
    initialConfig?.openingTime ?? DEFAULT_APPOINTMENT_OPENING_TIME,
  );
  const [closingTime, setClosingTime] = React.useState(
    initialConfig?.closingTime ?? DEFAULT_APPOINTMENT_CLOSING_TIME,
  );
  const [slotDuration, setSlotDuration] = React.useState(
    String(
      initialConfig?.slotDurationMinutes ??
        DEFAULT_APPOINTMENT_SLOT_DURATION_MINUTES,
    ),
  );
  const [slotCapacity, setSlotCapacity] = React.useState(
    String(initialConfig?.slotCapacity ?? DEFAULT_APPOINTMENT_SLOT_CAPACITY),
  );
  const [maxAdvanceDays, setMaxAdvanceDays] = React.useState(
    String(initialConfig?.maxAdvanceDays ?? DEFAULT_APPOINTMENT_MAX_ADVANCE_DAYS),
  );
  const [breaks, setBreaks] = React.useState<BreakDraft[]>(
    toBreakDrafts(initialConfig?.breaks),
  );
  const [unavailableDates, setUnavailableDates] = React.useState<string[]>(
    initialConfig?.unavailableDates ?? [],
  );
  const [newUnavailableDate, setNewUnavailableDate] = React.useState("");
  const [dateOverrides, setDateOverrides] = React.useState<
    DoctorScheduleDateOverride[]
  >(
    (initialConfig?.dateOverrides ?? []).map((entry) => ({
      ...entry,
      breaks: toBreakDrafts(entry.breaks),
    })),
  );
  const [newOverrideDate, setNewOverrideDate] = React.useState("");

  const [saving, setSaving] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [saved, setSaved] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);

  function touch() {
    setSaved(false);
    setDirty(true);
  }

  function toggleDay(day: number) {
    touch();
    setOperatingDays((current) =>
      current.includes(day)
        ? current.filter((value) => value !== day)
        : [...current, day].sort((a, b) => a - b),
    );
  }

  function updateOverride(
    index: number,
    patch: Partial<DoctorScheduleDateOverride>,
  ) {
    touch();
    setDateOverrides((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, ...patch } : entry,
      ),
    );
  }

  function updateOverrideBreak(
    overrideIndex: number,
    breakIndex: number,
    patch: Partial<BreakDraft>,
  ) {
    touch();
    setDateOverrides((current) =>
      current.map((entry, entryIndex) =>
        entryIndex === overrideIndex
          ? {
              ...entry,
              breaks: entry.breaks.map((item, itemIndex) =>
                itemIndex === breakIndex ? { ...item, ...patch } : item,
              ),
            }
          : entry,
      ),
    );
  }

  function addOverride() {
    if (!newOverrideDate) return;
    touch();
    setDateOverrides((current) => [
      ...current,
      {
        date: newOverrideDate,
        isClosed: false,
        openingTime,
        closingTime,
        slotDurationMinutes:
          Number(slotDuration) || DEFAULT_APPOINTMENT_SLOT_DURATION_MINUTES,
        slotCapacity:
          Number(slotCapacity) || DEFAULT_APPOINTMENT_SLOT_CAPACITY,
        breaks: [],
      },
    ]);
    setNewOverrideDate("");
  }

  function draftConfig(): DoctorScheduleConfig {
    return {
      timezone: timezone.trim(),
      operatingDays,
      openingTime,
      closingTime,
      slotDurationMinutes: Number(slotDuration),
      slotCapacity: Number(slotCapacity),
      maxAdvanceDays: Number(maxAdvanceDays),
      breaks: breaks.map((item) => ({ start: item.start, end: item.end })),
      unavailableDates,
      dateOverrides,
    };
  }

  const draft = draftConfig();
  const conflict = findScheduleConflict(
    draft,
    clinic.id,
    otherClinics,
    localDateString(),
  );

  async function handleSave() {
    if (saving || conflict) return;
    setFormError(null);
    setFieldErrors({});
    setSaved(false);

    if (operatingDays.length === 0) {
      setFormError("Select at least one operating day.");
      return;
    }
    if (
      !Number.isInteger(draft.slotDurationMinutes) ||
      draft.slotDurationMinutes < APPOINTMENT_SLOT_DURATION_MINUTES_MIN ||
      draft.slotDurationMinutes > APPOINTMENT_SLOT_DURATION_MINUTES_MAX
    ) {
      setFormError(
        `Slot duration must be a whole number between ${APPOINTMENT_SLOT_DURATION_MINUTES_MIN} and ${APPOINTMENT_SLOT_DURATION_MINUTES_MAX} minutes.`,
      );
      return;
    }
    if (
      !Number.isInteger(draft.slotCapacity) ||
      draft.slotCapacity < APPOINTMENT_SLOT_CAPACITY_MIN ||
      draft.slotCapacity > APPOINTMENT_SLOT_CAPACITY_MAX
    ) {
      setFormError(
        `Seats per slot must be a whole number between ${APPOINTMENT_SLOT_CAPACITY_MIN} and ${APPOINTMENT_SLOT_CAPACITY_MAX}.`,
      );
      return;
    }
    if (
      !Number.isInteger(draft.maxAdvanceDays) ||
      draft.maxAdvanceDays < APPOINTMENT_MAX_ADVANCE_DAYS_MIN ||
      draft.maxAdvanceDays > APPOINTMENT_MAX_ADVANCE_DAYS_MAX
    ) {
      setFormError(
        `Advance window must be between ${APPOINTMENT_MAX_ADVANCE_DAYS_MIN} and ${APPOINTMENT_MAX_ADVANCE_DAYS_MAX} days.`,
      );
      return;
    }
    if (closingTime <= openingTime) {
      setFormError("Closing time must be later than the opening time.");
      return;
    }
    if (breaks.some((item) => item.end <= item.start)) {
      setFormError("Every break must end later than it starts.");
      return;
    }
    if (
      dateOverrides.some(
        (entry) =>
          !entry.isClosed &&
          (entry.closingTime <= entry.openingTime ||
            entry.breaks.some((item) => item.end <= item.start)),
      )
    ) {
      setFormError("Check the special-date hours and breaks.");
      return;
    }

    setSaving(true);
    try {
      const response = await apiSend<
        ItemResponse<{ scheduleConfig: DoctorScheduleConfig | null }>
      >(
        `/api/doctors/${doctorId}/availability?clinicId=${encodeURIComponent(clinic.id)}`,
        "PATCH",
        draft,
      );
      setConfigured(response.data.scheduleConfig !== null);
      setSaved(true);
      setDirty(false);
      onSaved(clinic.id, response.data.scheduleConfig);
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setFieldErrors(issuesToErrors(error.issues));
        setFormError(error.message);
      } else {
        setFormError("Unable to save the schedule. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    if (removing) return;
    setRemoving(true);
    setFormError(null);
    try {
      await apiSend<ItemResponse<{ scheduleConfig: DoctorScheduleConfig | null }>>(
        `/api/doctors/${doctorId}/availability?clinicId=${encodeURIComponent(clinic.id)}`,
        "PATCH",
        null,
      );
      setConfigured(false);
      setSaved(false);
      setDirty(false);
      onSaved(clinic.id, null);
    } catch (error) {
      setFormError(
        error instanceof ApiRequestError
          ? error.message
          : "Unable to remove the schedule. Please try again.",
      );
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle>{clinic.name}</CardTitle>
            <Badge variant={configured ? "success" : "warning"} dot>
              {configured ? "Accepting bookings" : "Not configured"}
            </Badge>
            {!clinic.isActive ? (
              <Badge variant="danger" size="sm">
                Clinic inactive
              </Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {configured ? (
              <Button
                variant="outline"
                size="sm"
                disabled={removing || saving}
                onClick={() => setRemoving(true)}
              >
                <IconTrash className="size-4" />
                Remove schedule
              </Button>
            ) : null}
            <Button
              size="sm"
              loading={saving}
              disabled={Boolean(conflict)}
              onClick={() => void handleSave()}
            >
              Save schedule
            </Button>
          </div>
        </CardHeader>

        {conflict ? (
          <p
            role="alert"
            className="flex items-start gap-2 border-t border-danger-line bg-danger-soft px-4 py-2.5 text-sm text-danger sm:px-5"
          >
            <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
            {conflict.message}
          </p>
        ) : formError ? (
          <p
            role="alert"
            className="border-t border-danger-line bg-danger-soft px-4 py-2.5 text-sm text-danger sm:px-5"
          >
            {formError}
          </p>
        ) : saved ? (
          <p
            role="status"
            className="border-t border-primary/30 bg-primary-light px-4 py-2.5 text-sm text-primary-dark sm:px-5"
          >
            Schedule saved for {clinic.name}. Patients can book these times.
          </p>
        ) : dirty ? (
          <p
            role="status"
            className="border-t border-border bg-surface-muted px-4 py-2.5 text-sm text-ink-muted sm:px-5"
          >
            You have unsaved changes.
          </p>
        ) : null}

        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Input
              label="Opening time"
              name={`schedule-opening-${clinic.id}`}
              type="time"
              value={openingTime}
              onChange={(event) => {
                touch();
                setOpeningTime(event.target.value);
              }}
              error={fieldErrors.openingTime}
            />
            <Input
              label="Closing time"
              name={`schedule-closing-${clinic.id}`}
              type="time"
              value={closingTime}
              onChange={(event) => {
                touch();
                setClosingTime(event.target.value);
              }}
              error={fieldErrors.closingTime}
            />
            <Input
              label="Slot duration (minutes)"
              name={`schedule-slot-duration-${clinic.id}`}
              type="number"
              min={APPOINTMENT_SLOT_DURATION_MINUTES_MIN}
              max={APPOINTMENT_SLOT_DURATION_MINUTES_MAX}
              value={slotDuration}
              onChange={(event) => {
                touch();
                setSlotDuration(event.target.value);
              }}
              error={fieldErrors.slotDurationMinutes}
            />
            <Input
              label="Seats per slot"
              name={`schedule-slot-capacity-${clinic.id}`}
              type="number"
              min={APPOINTMENT_SLOT_CAPACITY_MIN}
              max={APPOINTMENT_SLOT_CAPACITY_MAX}
              value={slotCapacity}
              onChange={(event) => {
                touch();
                setSlotCapacity(event.target.value);
              }}
              error={fieldErrors.slotCapacity}
              hint="Simultaneous appointments."
            />
            <Input
              label="Advance booking (days)"
              name={`schedule-max-advance-${clinic.id}`}
              type="number"
              min={APPOINTMENT_MAX_ADVANCE_DAYS_MIN}
              max={APPOINTMENT_MAX_ADVANCE_DAYS_MAX}
              value={maxAdvanceDays}
              onChange={(event) => {
                touch();
                setMaxAdvanceDays(event.target.value);
              }}
              error={fieldErrors.maxAdvanceDays}
              hint="How far ahead patients may book."
            />
          </div>

          <div>
            <p className="form-label">Operating days</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {WEEKDAY_LABELS.map((label, day) => {
                const active = operatingDays.includes(day);
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleDay(day)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 ${
                      active
                        ? "border-primary bg-primary text-white"
                        : "border-border bg-surface text-ink-muted hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            {fieldErrors.operatingDays ? (
              <p className="form-error" role="alert">
                {fieldErrors.operatingDays}
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Timezone"
              name={`schedule-timezone-${clinic.id}`}
              value={
                TIMEZONE_SUGGESTIONS.includes(timezone)
                  ? timezone
                  : "__custom"
              }
              onChange={(event) => {
                touch();
                if (event.target.value !== "__custom") {
                  setTimezone(event.target.value);
                }
              }}
              options={[
                ...TIMEZONE_SUGGESTIONS.map((value) => ({
                  value,
                  label: value,
                })),
                { value: "__custom", label: "Custom (type below)" },
              ]}
            />
            <Input
              label="Timezone (IANA)"
              name={`schedule-timezone-custom-${clinic.id}`}
              value={timezone}
              onChange={(event) => {
                touch();
                setTimezone(event.target.value);
              }}
              placeholder="Asia/Kolkata"
              error={fieldErrors.timezone}
              hint="Must be a valid IANA timezone name."
            />
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="form-label">Breaks</p>
                <p className="form-hint">
                  Windows inside the working day that never receive slots.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={breaks.length >= APPOINTMENT_MAX_BREAKS}
                onClick={() => {
                  touch();
                  setBreaks((current) => [
                    ...current,
                    { start: "13:00", end: "14:00" },
                  ]);
                }}
              >
                <IconPlus className="size-4" />
                Add break
              </Button>
            </div>
            {breaks.length === 0 ? (
              <p className="rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-ink-muted">
                No breaks configured.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {breaks.map((item, index) => (
                  <li
                    key={index}
                    className="flex flex-wrap items-end gap-3 rounded-card border border-border p-3"
                  >
                    <Input
                      label={`Break ${index + 1} start`}
                      name={`break-start-${clinic.id}-${index}`}
                      type="time"
                      value={item.start}
                      onChange={(event) => {
                        touch();
                        setBreaks((current) =>
                          current.map((value, valueIndex) =>
                            valueIndex === index
                              ? { ...value, start: event.target.value }
                              : value,
                          ),
                        );
                      }}
                      containerClassName="w-auto"
                    />
                    <Input
                      label="End"
                      name={`break-end-${clinic.id}-${index}`}
                      type="time"
                      value={item.end}
                      onChange={(event) => {
                        touch();
                        setBreaks((current) =>
                          current.map((value, valueIndex) =>
                            valueIndex === index
                              ? { ...value, end: event.target.value }
                              : value,
                          ),
                        );
                      }}
                      containerClassName="w-auto"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        touch();
                        setBreaks((current) =>
                          current.filter(
                            (_, valueIndex) => valueIndex !== index,
                          ),
                        );
                      }}
                    >
                      <IconTrash className="size-4" />
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <p className="form-label">Leave / unavailable dates</p>
              <p className="form-hint">
                Full days off for this clinic inside the booking window.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Input
                label="Date"
                name={`unavailable-date-${clinic.id}`}
                type="date"
                min={localDateString()}
                value={newUnavailableDate}
                onChange={(event) => setNewUnavailableDate(event.target.value)}
                containerClassName="w-auto"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={
                  !newUnavailableDate ||
                  unavailableDates.includes(newUnavailableDate) ||
                  unavailableDates.length >= APPOINTMENT_MAX_UNAVAILABLE_DATES
                }
                onClick={() => {
                  touch();
                  setUnavailableDates((current) =>
                    [...current, newUnavailableDate].sort(),
                  );
                  setNewUnavailableDate("");
                }}
              >
                <IconPlus className="size-4" />
                Add date
              </Button>
            </div>
            {unavailableDates.length === 0 ? (
              <p className="rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-ink-muted">
                No unavailable dates.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {unavailableDates.map((date) => (
                  <li
                    key={date}
                    className="flex items-center gap-1 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm text-ink"
                  >
                    {date}
                    <button
                      type="button"
                      aria-label={`Remove ${date}`}
                      onClick={() => {
                        touch();
                        setUnavailableDates((current) =>
                          current.filter((value) => value !== date),
                        );
                      }}
                      className="ml-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
                    >
                      <IconTrash className="size-3.5 text-ink-subtle hover:text-danger" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <div>
              <p className="form-label">Special dates</p>
              <p className="form-hint">
                Replace the weekly hours or close the clinic on one date.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <Input
                label="Date"
                name={`override-date-${clinic.id}`}
                type="date"
                min={localDateString()}
                value={newOverrideDate}
                onChange={(event) => setNewOverrideDate(event.target.value)}
                containerClassName="w-auto"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={
                  !newOverrideDate ||
                  dateOverrides.some((entry) => entry.date === newOverrideDate) ||
                  unavailableDates.includes(newOverrideDate) ||
                  dateOverrides.length >= APPOINTMENT_MAX_DATE_OVERRIDES
                }
                onClick={addOverride}
              >
                <IconPlus className="size-4" />
                Add special date
              </Button>
            </div>
            {dateOverrides.length === 0 ? (
              <p className="rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-ink-muted">
                No special dates. The weekly schedule applies every week.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {dateOverrides.map((entry, index) => (
                  <li
                    key={entry.date}
                    className="flex flex-col gap-3 rounded-card border border-border p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-ink">
                        {entry.date}
                      </p>
                      <div className="flex flex-wrap items-center gap-3">
                        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                          <input
                            type="checkbox"
                            checked={entry.isClosed}
                            onChange={(event) =>
                              updateOverride(index, {
                                isClosed: event.target.checked,
                              })
                            }
                            className="size-4 accent-[#10B981]"
                          />
                          Closed all day
                        </label>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            touch();
                            setDateOverrides((current) =>
                              current.filter(
                                (_, valueIndex) => valueIndex !== index,
                              ),
                            );
                          }}
                        >
                          <IconTrash className="size-4" />
                          Remove
                        </Button>
                      </div>
                    </div>

                    {entry.isClosed ? (
                      <p className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm text-ink-muted">
                        No slots will be offered on this date.
                      </p>
                    ) : (
                      <>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          <Input
                            label="Opening time"
                            name={`override-opening-${clinic.id}-${index}`}
                            type="time"
                            value={entry.openingTime}
                            onChange={(event) =>
                              updateOverride(index, {
                                openingTime: event.target.value,
                              })
                            }
                          />
                          <Input
                            label="Closing time"
                            name={`override-closing-${clinic.id}-${index}`}
                            type="time"
                            value={entry.closingTime}
                            onChange={(event) =>
                              updateOverride(index, {
                                closingTime: event.target.value,
                              })
                            }
                          />
                          <Input
                            label="Slot duration"
                            name={`override-duration-${clinic.id}-${index}`}
                            type="number"
                            min={APPOINTMENT_SLOT_DURATION_MINUTES_MIN}
                            max={APPOINTMENT_SLOT_DURATION_MINUTES_MAX}
                            value={String(entry.slotDurationMinutes)}
                            onChange={(event) =>
                              updateOverride(index, {
                                slotDurationMinutes: Number(event.target.value),
                              })
                            }
                          />
                          <Input
                            label="Seats per slot"
                            name={`override-capacity-${clinic.id}-${index}`}
                            type="number"
                            min={APPOINTMENT_SLOT_CAPACITY_MIN}
                            max={APPOINTMENT_SLOT_CAPACITY_MAX}
                            value={String(entry.slotCapacity)}
                            onChange={(event) =>
                              updateOverride(index, {
                                slotCapacity: Number(event.target.value),
                              })
                            }
                          />
                        </div>

                        <div className="flex flex-col gap-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="form-label">Breaks on this date</p>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={
                                entry.breaks.length >= APPOINTMENT_MAX_BREAKS
                              }
                              onClick={() =>
                                updateOverride(index, {
                                  breaks: [
                                    ...entry.breaks,
                                    { start: "13:00", end: "14:00" },
                                  ],
                                })
                              }
                            >
                              <IconPlus className="size-4" />
                              Add break
                            </Button>
                          </div>
                          {entry.breaks.length === 0 ? (
                            <p className="text-sm text-ink-muted">
                              No breaks on this date.
                            </p>
                          ) : (
                            <ul className="flex flex-col gap-2">
                              {entry.breaks.map((item, breakIndex) => (
                                <li
                                  key={breakIndex}
                                  className="flex flex-wrap items-end gap-2"
                                >
                                  <Input
                                    label="Start"
                                    name={`override-break-start-${clinic.id}-${index}-${breakIndex}`}
                                    type="time"
                                    value={item.start}
                                    onChange={(event) =>
                                      updateOverrideBreak(
                                        index,
                                        breakIndex,
                                        { start: event.target.value },
                                      )
                                    }
                                    containerClassName="w-auto"
                                  />
                                  <Input
                                    label="End"
                                    name={`override-break-end-${clinic.id}-${index}-${breakIndex}`}
                                    type="time"
                                    value={item.end}
                                    onChange={(event) =>
                                      updateOverrideBreak(
                                        index,
                                        breakIndex,
                                        { end: event.target.value },
                                      )
                                    }
                                    containerClassName="w-auto"
                                  />
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      updateOverride(index, {
                                        breaks: entry.breaks.filter(
                                          (_, valueIndex) =>
                                            valueIndex !== breakIndex,
                                        ),
                                      })
                                    }
                                  >
                                    <IconTrash className="size-4" />
                                    Remove
                                  </Button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {!configured && !dirty ? (
        <Card>
          <CardContent className="text-sm text-ink-muted">
            This clinic has no schedule yet, so patients cannot book it. Set the
            hours above and save to start accepting appointments.
          </CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={removing}
        title={`Remove the ${clinic.name} schedule?`}
        description="Patients will no longer be able to book this clinic until a new schedule is saved. Existing appointments are not changed."
        confirmLabel="Remove schedule"
        cancelLabel="Keep schedule"
        tone="danger"
        loading={removing}
        onConfirm={() => void handleRemove()}
        onCancel={() => setRemoving(false)}
      />
    </div>
  );
}

export function DoctorScheduleEditor({
  doctorId,
  clinics,
  initialClinicId,
}: DoctorScheduleEditorProps) {
  const [selectedClinicId, setSelectedClinicId] =
    React.useState(initialClinicId);
  const [schedules, setSchedules] = React.useState<
    Record<string, DoctorScheduleConfig | null>
  >(() =>
    Object.fromEntries(
      clinics.map((clinic) => [clinic.id, clinic.scheduleConfig]),
    ),
  );

  const selectedClinic =
    clinics.find((clinic) => clinic.id === selectedClinicId) ?? clinics[0];
  const configuredCount = clinics.filter(
    (clinic) => schedules[clinic.id] !== null,
  ).length;

  if (!selectedClinic) {
    return (
      <Card>
        <CardContent className="text-sm text-ink-muted">
          No clinic is assigned to this doctor yet.
        </CardContent>
      </Card>
    );
  }

  const otherClinics = clinics
    .filter((clinic) => clinic.id !== selectedClinic.id)
    .map((clinic) => ({
      clinicId: clinic.id,
      clinicName: clinic.name,
      schedule: schedules[clinic.id] ?? null,
    }));

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <Select
            label="Clinic"
            name="schedule-clinic"
            value={selectedClinic.id}
            onChange={(event) => setSelectedClinicId(event.target.value)}
            options={clinics.map((clinic) => ({
              value: clinic.id,
              label: `${clinic.name}${clinic.code ? ` (${clinic.code})` : ""}${
                schedules[clinic.id] === null ? " - not configured" : ""
              }`,
            }))}
            containerClassName="sm:max-w-md"
          />
          <p className="text-sm text-ink-muted">
            {configuredCount} of {clinics.length} clinic
            {clinics.length === 1 ? "" : "s"} configured
          </p>
        </CardContent>
      </Card>

      <ClinicScheduleForm
        key={selectedClinic.id}
        doctorId={doctorId}
        clinic={selectedClinic}
        initialConfig={schedules[selectedClinic.id] ?? null}
        otherClinics={otherClinics}
        onSaved={(clinicId, config) =>
          setSchedules((current) => ({ ...current, [clinicId]: config }))
        }
      />
    </div>
  );
}
