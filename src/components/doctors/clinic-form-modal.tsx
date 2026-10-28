"use client";

import * as React from "react";

import {
  IconBuilding,
  IconMapPin,
  IconNavigation,
} from "@/components/icons";
import { ImageUploadField } from "@/components/shared/image-upload-field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiSend, ApiRequestError } from "@/lib/api/client";
import {
  clinicCreateSchema,
  clinicUpdateSchema,
  doctorClinicUpdateSchema,
} from "@/lib/validation/clinic";
import { toFieldIssues } from "@/lib/validation/common";
import {
  formatCoordinates,
  googleMapsUrl,
  hasMapLocation,
} from "@/lib/utils/location";
import type { ItemResponse } from "@/types/api";
import type { Clinic } from "@/types/clinic";
import { issuesToErrors, type FieldErrors } from "./shared";

interface ClinicFormValues {
  name: string;
  code: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  registrationNumber: string;
  imageUrl: string;
  latitude: number | null;
  longitude: number | null;
}

const EMPTY_VALUES: ClinicFormValues = {
  name: "",
  code: "",
  phone: "",
  email: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  registrationNumber: "",
  imageUrl: "",
  latitude: null,
  longitude: null,
};

function toFormValues(clinic?: Clinic | null): ClinicFormValues {
  if (!clinic) return { ...EMPTY_VALUES };
  return {
    name: clinic.name,
    code: clinic.code,
    phone: clinic.phone ?? "",
    email: clinic.email ?? "",
    address: clinic.address ?? "",
    city: clinic.city ?? "",
    state: clinic.state ?? "",
    pincode: clinic.pincode ?? "",
    registrationNumber: clinic.registrationNumber ?? "",
    imageUrl: clinic.imageUrl ?? "",
    latitude: clinic.latitude,
    longitude: clinic.longitude,
  };
}

export interface ClinicFormModalProps {
  open: boolean;
  onClose: () => void;
  /** `null` / omitted - create mode. */
  clinic?: Clinic | null;
  onSaved: (clinic: Clinic) => void;
  /** Doctor self-service mode: restricted fields and `/api/doctors/me/clinic`. */
  selfEdit?: boolean;
}

/**
 * Create / edit clinic dialog.
 *
 * Runs the shared Zod schema in the browser for instant feedback, then
 * re-validates on the server. The submit button locks while a request is in
 * flight so a double click cannot create a duplicate.
 */
export function ClinicFormModal({
  open,
  onClose,
  clinic,
  onSaved,
  selfEdit = false,
}: ClinicFormModalProps) {
  const isEdit = Boolean(clinic);
  const isSelfEdit = selfEdit && isEdit;
  const [values, setValues] = React.useState<ClinicFormValues>(() =>
    toFormValues(clinic),
  );
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [locating, setLocating] = React.useState(false);
  const [locationError, setLocationError] = React.useState<string | null>(null);

  // Reset the form whenever the dialog opens. Render-phase adjustment keeps
  // stale values from the previous record from leaking into the next edit.
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setValues(toFormValues(clinic));
      setErrors({});
      setFormError(null);
      setSubmitting(false);
      setLocating(false);
      setLocationError(null);
    }
  }

  function update<K extends keyof ClinicFormValues>(
    key: K,
    value: ClinicFormValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  }

  function captureCurrentLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationError(
        "Your browser does not support location capture. Use a modern browser to add the clinic location.",
      );
      return;
    }

    setLocating(true);
    setLocationError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = Number(position.coords.latitude.toFixed(6));
        const longitude = Number(position.coords.longitude.toFixed(6));

        setValues((current) => ({ ...current, latitude, longitude }));
        setErrors((current) => {
          if (!current.latitude && !current.longitude) return current;
          const next = { ...current };
          delete next.latitude;
          delete next.longitude;
          return next;
        });
        setLocating(false);
      },
      (error) => {
        setLocationError(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied. Allow location access for this site, then try again."
            : error.code === error.TIMEOUT
              ? "Finding the clinic location took too long. Please try again."
              : "The clinic location is unavailable right now. Please try again.",
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const schema = isSelfEdit
      ? doctorClinicUpdateSchema
      : isEdit
        ? clinicUpdateSchema
        : clinicCreateSchema;
    const parsed = schema.safeParse(values);

    if (!parsed.success) {
      setErrors(toFieldIssues(parsed.error).reduce<FieldErrors>((acc, issue) => {
        if (!acc[issue.field]) acc[issue.field] = issue.message;
        return acc;
      }, {}));
      setFormError(null);
      return;
    }

    setSubmitting(true);
    setErrors({});
    setFormError(null);

    try {
      const url = isSelfEdit
        ? "/api/doctors/me/clinic"
        : isEdit
          ? `/api/clinics/${clinic!.id}`
          : "/api/clinics";
      const method = isEdit ? "PATCH" : "POST";
      const result = await apiSend<ItemResponse<Clinic>>(url, method, parsed.data);
      onSaved(result.data);
      onClose();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        setErrors(issuesToErrors(error.issues));
        setFormError(error.message);
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const hasLocation = hasMapLocation(values);

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title={isEdit ? "Edit clinic" : "Add clinic"}
      description={
        isSelfEdit
          ? "Update your clinic's contact and location details. Clinic code and status stay with the administrator."
          : isEdit
            ? "Update the clinic details below."
            : "Register a new clinic in the directory."
      }
      size="lg"
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
          <Button
            type="submit"
            form="clinic-form"
            loading={submitting}
          >
            {isEdit ? "Save changes" : "Create clinic"}
          </Button>
        </>
      }
    >
      <form id="clinic-form" onSubmit={handleSubmit} noValidate>
        {formError ? (
          <div
            role="alert"
            className="mb-4 rounded-control border border-danger-line bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
          >
            {formError}
          </div>
        ) : null}

        <ImageUploadField
          kind="clinic"
          label="Clinic photo"
          description="This photo is shown to everyone who views the clinic."
          value={values.imageUrl || null}
          onChange={(url) => update("imageUrl", url ?? "")}
          fallback={<IconBuilding className="size-8" />}
          className="mb-5"
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Clinic name"
            name="name"
            required
            autoComplete="organization"
            value={values.name}
            onChange={(event) => update("name", event.target.value)}
            error={errors.name}
            containerClassName="sm:col-span-2"
            placeholder="e.g. City Care Clinic"
          />

          {!isSelfEdit ? (
            <Input
              label="Clinic code"
              name="code"
              required
              value={values.code}
              onChange={(event) => update("code", event.target.value)}
              error={errors.code}
              hint="Unique business code, e.g. CLINIC-01"
              placeholder="CLINIC-01"
            />
          ) : null}

          <Input
            label="Registration number"
            name="registrationNumber"
            value={values.registrationNumber}
            onChange={(event) => update("registrationNumber", event.target.value)}
            error={errors.registrationNumber}
            placeholder="Optional"
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
            placeholder="clinic@example.com"
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

          <div className="rounded-control border border-border bg-surface-muted p-4 sm:col-span-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="flex items-center gap-2 text-sm font-medium text-ink">
                  <IconMapPin className="size-4 text-primary" aria-hidden="true" />
                  Clinic location
                </p>
                <p className="mt-1 text-xs text-ink-muted">
                  Capture the clinic&apos;s exact coordinates so patients can
                  open the location in Google Maps.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={locating}
                onClick={captureCurrentLocation}
                disabled={submitting}
              >
                <IconNavigation className="size-4" />
                {hasLocation ? "Update current location" : "Use current location"}
              </Button>
            </div>

            {hasLocation ? (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-control border border-border bg-surface px-3 py-2.5 text-xs">
                <span className="font-medium text-ink">
                  {formatCoordinates(values.latitude!, values.longitude!)}
                </span>
                <a
                  href={googleMapsUrl(values.latitude!, values.longitude!)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  <IconMapPin className="size-3.5" aria-hidden="true" />
                  Open in Google Maps
                </a>
                <button
                  type="button"
                  className="ml-auto font-medium text-ink-muted hover:text-danger"
                  onClick={() => {
                    update("latitude", null);
                    update("longitude", null);
                    setLocationError(null);
                  }}
                >
                  Remove
                </button>
              </div>
            ) : (
              <p className="mt-3 text-xs text-ink-subtle">
                No map location captured yet. Tap &quot;Use current location&quot;
                while you are at the clinic.
              </p>
            )}

            {locationError ? (
              <p role="alert" className="mt-2 text-xs text-danger">
                {locationError}
              </p>
            ) : null}
          </div>
        </div>
      </form>
    </Modal>
  );
}
