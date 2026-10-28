"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { SkeletonCard } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  PATIENT_BLOOD_GROUPS,
  PATIENT_BLOOD_GROUP_LABELS,
  PATIENT_GENDERS,
  PATIENT_GENDER_LABELS,
} from "@/config/patients";
import { ApiRequestError, apiGet, apiSend } from "@/lib/api/client";
import { toFieldIssues } from "@/lib/validation/common";
import { patientSelfPutSchema } from "@/lib/validation/patient";
import type { PatientSelfDto } from "@/lib/patient/dto";
import type { ItemResponse } from "@/types/api";

type FieldErrors = Record<string, string>;

interface FormValues {
  dateOfBirth: string;
  gender: string;
  bloodGroup: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pincode: string;
  emergencyName: string;
  emergencyPhone: string;
  emergencyRelationship: string;
}

const GENDER_OPTIONS = [
  { value: "", label: "Not specified" },
  ...PATIENT_GENDERS.map((value) => ({
    value,
    label: PATIENT_GENDER_LABELS[value],
  })),
];

const BLOOD_GROUP_OPTIONS = [
  { value: "", label: "Not specified" },
  ...PATIENT_BLOOD_GROUPS.map((value) => ({
    value,
    label: PATIENT_BLOOD_GROUP_LABELS[value],
  })),
];

function toFormValues(profile: PatientSelfDto["profile"]): FormValues {
  return {
    dateOfBirth: profile.dateOfBirth ?? "",
    gender: profile.gender ?? "",
    bloodGroup: profile.bloodGroup ?? "",
    addressLine1: profile.address?.line1 ?? "",
    addressLine2: profile.address?.line2 ?? "",
    city: profile.address?.city ?? "",
    state: profile.address?.state ?? "",
    pincode: profile.address?.pincode ?? "",
    emergencyName: profile.emergencyContact?.name ?? "",
    emergencyPhone: profile.emergencyContact?.phone ?? "",
    emergencyRelationship: profile.emergencyContact?.relationship ?? "",
  };
}

/**
 * Patient self-service demographics editor for `/profile` (PATIENT only).
 * Loads `GET /api/patients/me` (synthesized blank profile for legacy
 * accounts, no write on read) and saves through `PUT /api/patients/me`.
 * Staff-only `notes` and the record-status switch are not part of this
 * surface and cannot be submitted from here.
 */
export function PatientSelfEditor() {
  const { success: showSuccess, error: showError } = useToast();
  const [profile, setProfile] = React.useState<
    PatientSelfDto["profile"] | null
  >(null);
  const [values, setValues] = React.useState<FormValues>(() =>
    toFormValues({
      dateOfBirth: null,
      gender: null,
      bloodGroup: null,
      address: null,
      emergencyContact: null,
      isActive: true,
      hasProfile: false,
      updatedAt: null,
    }),
  );
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [reloadTick, setReloadTick] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    apiGet<ItemResponse<PatientSelfDto>>("/api/patients/me")
      .then((result) => {
        if (cancelled) return;
        setProfile(result.data.profile);
        setValues(toFormValues(result.data.profile));
        setLoadError("");
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof ApiRequestError
            ? error.message
            : "Your health profile could not be loaded.",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadTick]);

  function update<K extends keyof FormValues>(key: K, value: FormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const hasAddress = values.addressLine1.trim().length > 0;
    const hasEmergency = values.emergencyName.trim().length > 0;

    const payload = {
      dateOfBirth: values.dateOfBirth || null,
      gender: values.gender || null,
      bloodGroup: values.bloodGroup || null,
      address: hasAddress
        ? {
            line1: values.addressLine1,
            line2: values.addressLine2 || null,
            city: values.city,
            state: values.state,
            pincode: values.pincode,
          }
        : null,
      emergencyContact: hasEmergency
        ? {
            name: values.emergencyName,
            phone: values.emergencyPhone,
            relationship: values.emergencyRelationship || null,
          }
        : null,
    };

    const parsed = patientSelfPutSchema.safeParse(payload);
    if (!parsed.success) {
      const next: FieldErrors = {};
      for (const issue of toFieldIssues(parsed.error)) {
        next[issue.field] = issue.message;
      }
      setErrors(next);
      setFormError(null);
      return;
    }

    setSubmitting(true);
    setErrors({});
    setFormError(null);

    try {
      const result = await apiSend<ItemResponse<PatientSelfDto>>(
        "/api/patients/me",
        "PUT",
        parsed.data,
      );
      setProfile(result.data.profile);
      setValues(toFormValues(result.data.profile));
      showSuccess("Profile saved", "Your health details have been updated.");
    } catch (error) {
      if (error instanceof ApiRequestError) {
        const next: FieldErrors = {};
        for (const issue of error.issues ?? []) {
          next[issue.field] = issue.message;
        }
        setErrors(next);
        setFormError(error.message);
        showError("Could not save profile", error.message);
      } else {
        setFormError("Something went wrong. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <SkeletonCard />;
  }

  if (loadError) {
    return (
      <ErrorState
        title="Health profile could not be loaded"
        description={loadError}
        onRetry={() => {
          setLoading(true);
          setLoadError("");
          setReloadTick((tick) => tick + 1);
        }}
      />
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Health profile</CardTitle>
        {!profile?.hasProfile ? (
          <p className="text-xs text-ink-muted">
            Your account has no health details yet - fill in what you would
            like the laboratory to know.
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} noValidate>
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
              label="Date of birth"
              name="dateOfBirth"
              type="date"
              value={values.dateOfBirth}
              onChange={(event) => update("dateOfBirth", event.target.value)}
              error={errors.dateOfBirth}
            />

            <Select
              label="Gender"
              name="gender"
              value={values.gender}
              onChange={(event) => update("gender", event.target.value)}
              options={GENDER_OPTIONS}
              error={errors.gender}
            />

            <Select
              label="Blood group"
              name="bloodGroup"
              value={values.bloodGroup}
              onChange={(event) => update("bloodGroup", event.target.value)}
              options={BLOOD_GROUP_OPTIONS}
              error={errors.bloodGroup}
            />

            <Input
              label="Address line 1"
              name="addressLine1"
              value={values.addressLine1}
              onChange={(event) => update("addressLine1", event.target.value)}
              error={errors["address.line1"]}
            />

            <Input
              label="Address line 2"
              name="addressLine2"
              value={values.addressLine2}
              onChange={(event) => update("addressLine2", event.target.value)}
              error={errors["address.line2"]}
            />

            <Input
              label="City"
              name="city"
              value={values.city}
              onChange={(event) => update("city", event.target.value)}
              error={errors["address.city"]}
            />

            <Input
              label="State"
              name="state"
              value={values.state}
              onChange={(event) => update("state", event.target.value)}
              error={errors["address.state"]}
            />

            <Input
              label="Pincode"
              name="pincode"
              value={values.pincode}
              onChange={(event) => update("pincode", event.target.value)}
              error={errors["address.pincode"]}
            />

            <Input
              label="Emergency contact name"
              name="emergencyName"
              value={values.emergencyName}
              onChange={(event) => update("emergencyName", event.target.value)}
              error={errors["emergencyContact.name"]}
            />

            <Input
              label="Emergency contact phone"
              name="emergencyPhone"
              type="tel"
              value={values.emergencyPhone}
              onChange={(event) => update("emergencyPhone", event.target.value)}
              error={errors["emergencyContact.phone"]}
            />

            <Input
              label="Emergency contact relationship"
              name="emergencyRelationship"
              value={values.emergencyRelationship}
              onChange={(event) =>
                update("emergencyRelationship", event.target.value)
              }
              error={errors["emergencyContact.relationship"]}
            />
          </div>

          <div className="mt-5">
            <Button type="submit" loading={submitting}>
              Save health profile
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
