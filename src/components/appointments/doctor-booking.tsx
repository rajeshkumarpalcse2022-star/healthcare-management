"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import {
  IconArrowRight,
  IconBuilding,
  IconCheckCircle,
  IconMapPin,
  IconSearch,
  IconStethoscope,
} from "@/components/icons";
import { EntityAvatar } from "@/components/shared/entity-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils/cn";
import { apiGet, apiSend, ApiRequestError } from "@/lib/api/client";
import {
  APPOINTMENT_REASON_MAX_LENGTH,
  APPOINTMENT_TYPE_LABELS,
} from "@/config/appointments";
import { localDateString } from "@/lib/utils/dashboard-rows";
import { googleMapsUrl, hasMapLocation } from "@/lib/utils/location";
import type { ItemResponse } from "@/types/api";
import type {
  AppointmentAvailability,
  AppointmentDetail,
  DoctorPublicProfile,
} from "@/types/appointment";
import { issuesToErrors, type FieldErrors } from "./shared";

export interface DoctorBookingPanelProps {
  doctorId: string;
}

/**
 * Patient booking flow for one doctor (`/find-a-doctor/[id]`).
 *
 * Profile comes from the public-safe directory endpoint; every slot shown is
 * read live from `GET /api/appointments/availability` (never derived client
 * side), and submission posts with a client-generated idempotency key so a
 * double click or retry cannot create a second appointment or double-claim
 * capacity.
 */
export function DoctorBookingPanel({ doctorId }: DoctorBookingPanelProps) {
  const router = useRouter();
  const idempotencyKeyRef = React.useRef<string>(newIdempotencyKey());

  const [profileAttempt, setProfileAttempt] = React.useState(0);
  const profileKey = `${doctorId}#${profileAttempt}`;
  // Keyed results - loading / error states derive from the current request
  // key so effects never reset state synchronously.
  const [profileResult, setProfileResult] = React.useState<{
    key: string;
    profile: DoctorPublicProfile | null;
    error: string | null;
  } | null>(null);

  const today = React.useMemo(() => localDateString(), []);
  const [clinicId, setClinicId] = React.useState("");
  const [date, setDate] = React.useState("");
  const [selectedSlot, setSelectedSlot] = React.useState<string | null>(null);
  const [appointmentType, setAppointmentType] = React.useState("");
  const [reason, setReason] = React.useState("");

  const [availabilityAttempt, setAvailabilityAttempt] = React.useState(0);
  const availKey = `${doctorId}|${clinicId}|${date.length === 10 ? date : ""}|${availabilityAttempt}`;
  const [availResult, setAvailResult] = React.useState<{
    key: string;
    data: AppointmentAvailability | null;
    error: string | null;
  } | null>(null);

  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [booked, setBooked] = React.useState<AppointmentDetail | null>(null);

  /* ---------------- profile ---------------- */
  React.useEffect(() => {
    let active = true;
    apiGet<ItemResponse<DoctorPublicProfile>>(
      `/api/doctors/directory/${doctorId}`,
    )
      .then((payload) => {
        if (!active) return;
        setProfileResult({
          key: profileKey,
          profile: payload.data,
          error: null,
        });
        setAppointmentType(payload.data.appointmentTypes[0] ?? "CLINIC_VISIT");
        setClinicId((current) => current || payload.data.clinics[0]?.id || "");
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        setProfileResult({
          key: profileKey,
          profile: null,
          error:
            requestError instanceof ApiRequestError
              ? requestError.message
              : "Unable to load this doctor.",
        });
      });
    return () => {
      active = false;
    };
  }, [profileKey, doctorId]);

  const currentProfile =
    profileResult !== null && profileResult.key === profileKey
      ? profileResult
      : null;
  const profileLoading = currentProfile === null;
  const profile = currentProfile?.profile ?? null;
  const profileError = currentProfile?.error ?? null;
  const selectedClinic =
    profile?.clinics.find((clinic) => clinic.id === clinicId) ??
    profile?.clinics[0] ??
    null;

  /* ---------------- availability ---------------- */
  React.useEffect(() => {
    if (date.length !== 10 || !clinicId) return;
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
              : "Unable to load available times.",
        });
      });
    return () => {
      active = false;
    };
  }, [doctorId, clinicId, date, availabilityAttempt, availKey]);
  const currentAvail =
    availResult !== null && availResult.key === availKey ? availResult : null;
  const availability = currentAvail?.data ?? null;
  const availabilityError = currentAvail?.error ?? null;
  const availabilityLoading =
    date.length === 10 && Boolean(clinicId) && currentAvail === null;

  const schedule = availability?.schedule ?? null;
  const maxDate = React.useMemo(() => {
    if (!schedule) return null;
    const base = new Date(`${today}T00:00:00.000Z`);
    base.setUTCDate(base.getUTCDate() + schedule.maxAdvanceDays);
    return base.toISOString().slice(0, 10);
  }, [schedule, today]);

  async function handleSubmit() {
    if (submitting || !selectedSlot) return;
    setSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});

    try {
      const response = await apiSend<ItemResponse<AppointmentDetail>>(
        "/api/appointments",
        "POST",
        {
          doctorId,
          clinicId,
          appointmentDate: date,
          timeSlot: selectedSlot,
          appointmentType: appointmentType || "CLINIC_VISIT",
          reason: reason.trim().length > 0 ? reason.trim() : undefined,
          idempotencyKey: idempotencyKeyRef.current,
        },
      );
      idempotencyKeyRef.current = newIdempotencyKey();
      setBooked(response.data);
      setSelectedSlot(null);
      setReason("");
      setDate("");
    } catch (error) {
      if (error instanceof ApiRequestError) {
        const issues = issuesToErrors(error.issues);
        setFieldErrors(issues);
        setSubmitError(
          Object.keys(issues).length === 0 ? error.message : null,
        );
        // A rejected slot is stale - reload availability for this date.
        setAvailabilityAttempt((value) => value + 1);
      } else {
        setSubmitError(
          "Unable to create the appointment. Please try again.",
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (profileLoading) {
    return (
      <Card>
        <CardContent className="space-y-3" aria-hidden="true">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (profileError || !profile) {
    return (
      <Card>
        <CardContent>
          <ErrorState
            title="Unable to load this doctor"
            description={profileError ?? "The doctor was not found."}
            onRetry={() => setProfileAttempt((value) => value + 1)}
          />
        </CardContent>
      </Card>
    );
  }

  if (booked) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={IconCheckCircle}
            title="Appointment requested"
            description={`Request ${booked.appointmentCode} for ${booked.date} at ${booked.timeSlot}${
              booked.clinic ? ` at ${booked.clinic.name}` : ""
            } is waiting for the doctor's confirmation.`}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  size="sm"
                  onClick={() => router.push(`/appointments/${booked.id}`)}
                >
                  View appointment
                  <IconArrowRight className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push("/my-appointments")}
                >
                  My appointments
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setBooked(null);
                    setAppointmentType(
                      profile.appointmentTypes[0] ?? "CLINIC_VISIT",
                    );
                  }}
                >
                  Book another time
                </Button>
              </div>
            }
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Profile */}
      <Card className="lg:col-span-1">
        <CardHeader>
          <div className="flex items-start gap-3">
            <EntityAvatar
              src={profile.profileImageUrl}
              alt={profile.name}
              fallback={<IconStethoscope className="size-6" />}
              className="size-14"
              sizes="56px"
            />
            <div className="min-w-0">
              <CardTitle>{profile.name}</CardTitle>
              <p className="mt-1 text-sm text-primary">
                {profile.specialization}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            <Badge
              variant={profile.scheduleConfigured ? "success" : "warning"}
              size="sm"
              dot
            >
              {profile.scheduleConfigured ? "Accepting bookings" : "Not configured"}
            </Badge>
            {profile.appointmentTypes.map((type) => (
              <Badge key={type} variant="info" size="sm">
                {APPOINTMENT_TYPE_LABELS[type]}
              </Badge>
            ))}
          </div>
          <dl className="flex flex-col gap-2 text-sm text-ink-muted">
            {profile.qualification ? (
              <div className="flex gap-2">
                <dt className="text-ink-subtle">Qualification</dt>
                <dd className="truncate">{profile.qualification}</dd>
              </div>
            ) : null}
            {profile.experienceYears !== null ? (
              <div className="flex gap-2">
                <dt className="text-ink-subtle">Experience</dt>
                <dd>{profile.experienceYears} yrs</dd>
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5">
              <dt className="text-ink-subtle">
                Clinic{profile.clinics.length > 1 ? "s" : ""}
              </dt>
              <dd className="flex flex-col gap-2">
                {profile.clinics.length === 0 ? (
                  <span>Unassigned</span>
                ) : (
                  profile.clinics.map((clinic) => (
                    <span
                      key={clinic.id}
                      className="flex min-w-0 items-center gap-2"
                    >
                      <EntityAvatar
                        src={clinic.imageUrl}
                        alt={clinic.name}
                        fallback={<IconBuilding className="size-3" />}
                        className="size-6"
                        sizes="24px"
                      />
                      <span className="truncate">
                        {clinic.name}
                        {clinic.city ? ` - ${clinic.city}` : ""}
                        {!clinic.scheduleConfigured ? " (not bookable)" : ""}
                      </span>
                      {hasMapLocation(clinic) ? (
                        <a
                          href={googleMapsUrl(
                            clinic.latitude,
                            clinic.longitude,
                          )}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open ${clinic.name} in Google Maps`}
                          className="shrink-0 text-primary hover:text-primary-hover"
                        >
                          <IconMapPin className="size-3.5" />
                        </a>
                      ) : null}
                    </span>
                  ))
                )}
              </dd>
            </div>
            {profile.bio ? (
              <p className="whitespace-pre-wrap border-t border-border pt-3 text-ink-muted">
                {profile.bio}
              </p>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      {/* Booking form */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Book an appointment</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {submitError ? (
            <p role="alert" className="form-error">
              {submitError}
            </p>
          ) : null}

          {!selectedClinic?.scheduleConfigured ? (
            <p
              role="status"
              className="rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-ink-muted"
            >
              This clinic has not configured availability yet - booking opens
              once its schedule is published.
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Select
              label="Clinic"
              name="booking-clinic"
              value={selectedClinic?.id ?? ""}
              onChange={(event) => {
                setClinicId(event.target.value);
                setDate("");
                setSelectedSlot(null);
                setSubmitError(null);
              }}
              error={fieldErrors.clinicId}
              options={profile.clinics.map((clinic) => ({
                value: clinic.id,
                label: `${clinic.name}${clinic.city ? ` - ${clinic.city}` : ""}${
                  clinic.scheduleConfigured ? "" : " (not bookable)"
                }`,
              }))}
              disabled={profile.clinics.length === 0}
            />
            <Select
              label="Consultation type"
              name="booking-type"
              value={appointmentType}
              onChange={(event) => setAppointmentType(event.target.value)}
              error={fieldErrors.appointmentType}
              options={profile.appointmentTypes.map((type) => ({
                value: type,
                label: APPOINTMENT_TYPE_LABELS[type],
              }))}
              disabled={!selectedClinic?.scheduleConfigured}
            />
            <Input
              label="Preferred date"
              name="booking-date"
              type="date"
              value={date}
              min={today}
              max={maxDate ?? undefined}
              onChange={(event) => {
                setDate(event.target.value);
                setSelectedSlot(null);
                setSubmitError(null);
              }}
              error={fieldErrors.appointmentDate}
              hint={
                schedule
                  ? `Up to ${schedule.maxAdvanceDays} day(s) ahead.`
                  : "Pick a date to see available times."
              }
              disabled={!selectedClinic?.scheduleConfigured}
              containerClassName="sm:col-span-2"
            />
          </div>

          {availability?.dateSchedule ? (
            <p className="rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-ink-muted">
              {availability.clinicName}:{" "}
              {availability.dateSchedule.openingTime}-
              {availability.dateSchedule.closingTime} ·{" "}
              {availability.dateSchedule.slotDurationMinutes} min slots ·{" "}
              {availability.dateSchedule.slotCapacity} seat
              {availability.dateSchedule.slotCapacity === 1 ? "" : "s"} each
            </p>
          ) : null}

          {/* Slots */}
          <div className="flex flex-col gap-2">
            <p className="form-label">Available times</p>
            {date.length !== 10 ? (
              <p className="rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-ink-muted">
                Select a date to see the doctor&apos;s free slots.
              </p>
            ) : availabilityError ? (
              <ErrorState
                title="Unable to load available times"
                description={availabilityError}
                onRetry={() => setAvailabilityAttempt((value) => value + 1)}
                className="py-4"
              />
            ) : availabilityLoading ? (
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
            ) : availability && availability.slots.length > 0 ? (
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
            ) : (
              <p className="rounded-lg border border-border bg-surface-muted px-3 py-2.5 text-sm text-ink-muted">
                No slots are generated for this date.
              </p>
            )}
            {fieldErrors.timeSlot ? (
              <p className="form-error" role="alert">
                {fieldErrors.timeSlot}
              </p>
            ) : null}
          </div>

          <Textarea
            label="Reason (optional)"
            name="booking-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={APPOINTMENT_REASON_MAX_LENGTH}
            error={fieldErrors.reason}
            placeholder="What would you like to discuss?"
            hint="Shared with the doctor so they can prepare."
            rows={3}
          />

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-xs text-ink-subtle">
              <IconSearch className="mr-1 inline size-3.5" />
              {selectedSlot
                ? `${date} at ${selectedSlot} with Dr. ${profile.name}${
                    selectedClinic ? ` at ${selectedClinic.name}` : ""
                  }`
                : "Select a time slot to continue."}
            </p>
            <Button
              disabled={!selectedSlot || submitting || !selectedClinic}
              loading={submitting}
              onClick={() => void handleSubmit()}
            >
              Request appointment
              <IconArrowRight className="size-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `apt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
