"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import {
  PATIENT_BLOOD_GROUPS,
  PATIENT_BLOOD_GROUP_LABELS,
  PATIENT_GENDERS,
  PATIENT_GENDER_LABELS,
} from "@/config/patients";
import { ApiRequestError, apiSend } from "@/lib/api/client";
import { toFieldIssues } from "@/lib/validation/common";
import { patientPatchSchema } from "@/lib/validation/patient";
import type { PatientDto } from "@/lib/patient/dto";
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
  notes: string;
  isActive: boolean;
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

function toFormValues(patient: PatientDto | null): FormValues {
  const profile = patient?.profile;
  return {
    dateOfBirth: profile?.dateOfBirth ?? "",
    gender: profile?.gender ?? "",
    bloodGroup: profile?.bloodGroup ?? "",
    addressLine1: profile?.address?.line1 ?? "",
    addressLine2: profile?.address?.line2 ?? "",
    city: profile?.address?.city ?? "",
    state: profile?.address?.state ?? "",
    pincode: profile?.address?.pincode ?? "",
    emergencyName: profile?.emergencyContact?.name ?? "",
    emergencyPhone: profile?.emergencyContact?.phone ?? "",
    emergencyRelationship: profile?.emergencyContact?.relationship ?? "",
    notes: profile?.notes ?? "",
    isActive: profile?.isActive ?? true,
  };
}

interface PatientProfileModalProps {
  /** Patient being edited (`null` = closed). */
  patient: PatientDto | null;
  onClose: () => void;
  onSaved: (patient: PatientDto) => void;
}

/**
 * Demographics edit dialog (ADMIN / SUPER_ADMIN). Doubles as the "Add
 * profile" action for legacy PATIENT accounts that have no profile row yet -
 * the PATCH upserts. Always submits the complete form, so `null` values
 * intentionally clear any field left blank.
 */
export function PatientProfileModal({
  patient,
  onClose,
  onSaved,
}: PatientProfileModalProps) {
  const { success: showSuccess } = useToast();
  const open = patient !== null;
  const [values, setValues] = React.useState<FormValues>(() =>
    toFormValues(patient),
  );
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const [prevPatient, setPrevPatient] = React.useState<PatientDto | null>(
    patient,
  );
  if (patient !== prevPatient) {
    setPrevPatient(patient);
    if (patient) {
      setValues(toFormValues(patient));
      setErrors({});
      setFormError(null);
      setSubmitting(false);
    }
  }

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
    if (submitting || !patient) return;

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
      notes: values.notes.trim() ? values.notes : null,
      isActive: values.isActive,
    };

    const parsed = patientPatchSchema.safeParse(payload);
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
      const result = await apiSend<ItemResponse<PatientDto>>(
        `/api/patients/${patient.id}`,
        "PATCH",
        parsed.data,
      );
      showSuccess("Patient updated", `${result.data.name} has been saved.`);
      onSaved(result.data);
      onClose();
    } catch (error) {
      if (error instanceof ApiRequestError) {
        const next: FieldErrors = {};
        for (const issue of error.issues ?? []) {
          next[issue.field] = issue.message;
        }
        setErrors(next);
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
      title={
        patient?.profile.hasProfile
          ? `Edit ${patient.name}`
          : `Add profile for ${patient?.name ?? "patient"}`
      }
      description="Demographics and staff-only notes. The record switch controls visibility in new-booking flows."
      dismissible={!submitting}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="patient-profile-form" loading={submitting}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="patient-profile-form" onSubmit={handleSubmit} noValidate>
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

          <Input
            label="Staff notes"
            name="notes"
            value={values.notes}
            onChange={(event) => update("notes", event.target.value)}
            error={errors.notes}
            hint="Visible to staff only - never shown to the patient."
            containerClassName="sm:col-span-2"
          />

          <label className="flex cursor-pointer items-center gap-2.5 sm:col-span-2">
            <input
              type="checkbox"
              name="is-active"
              checked={values.isActive}
              onChange={(event) => update("isActive", event.target.checked)}
              disabled={submitting}
              className="size-4 rounded-xs border-border text-primary accent-primary"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-ink">
                Record is active
              </span>
              <span className="block text-xs text-ink-muted">
                Deactivated records are hidden from pickers and cannot create
                new bookings. Existing history stays intact.
              </span>
            </span>
          </label>
        </div>
      </form>
    </Modal>
  );
}
