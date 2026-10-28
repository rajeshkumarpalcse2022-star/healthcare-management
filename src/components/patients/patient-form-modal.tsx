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
import { patientCreateSchema } from "@/lib/validation/patient";
import type { PatientDto } from "@/lib/patient/dto";
import type { ItemResponse } from "@/types/api";

type FieldErrors = Record<string, string>;

interface FormValues {
  name: string;
  email: string;
  phone: string;
  /** Optional - blank means the server generates a temporary password. */
  password: string;
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

function emptyValues(): FormValues {
  return {
    name: "",
    email: "",
    phone: "",
    password: "",
    dateOfBirth: "",
    gender: "",
    bloodGroup: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    pincode: "",
    emergencyName: "",
    emergencyPhone: "",
    emergencyRelationship: "",
    notes: "",
  };
}

interface PatientFormModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (patient: PatientDto) => void;
}

/**
 * Create-patient dialog (ADMIN / SUPER_ADMIN). Identity fields create the
 * PATIENT account; demographics are optional and upserted onto the new
 * profile. Leaving the password blank makes the server generate a temporary
 * one, which this dialog displays exactly once after a successful create -
 * it is never re-fetchable.
 */
export function PatientFormModal({
  open,
  onClose,
  onSaved,
}: PatientFormModalProps) {
  const { success: showSuccess } = useToast();
  const [values, setValues] = React.useState<FormValues>(emptyValues);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  /** One-time temporary password panel after a generated-password create. */
  const [createdPassword, setCreatedPassword] = React.useState<string | null>(
    null,
  );

  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setValues(emptyValues());
      setErrors({});
      setFormError(null);
      setSubmitting(false);
      setCreatedPassword(null);
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
    if (submitting) return;

    const hasAddress = values.addressLine1.trim().length > 0;
    const hasEmergency = values.emergencyName.trim().length > 0;
    const hasDemographics =
      Boolean(
        values.dateOfBirth ||
          values.gender ||
          values.bloodGroup ||
          hasAddress ||
          hasEmergency ||
          values.notes.trim(),
      ) || false;

    const payload = {
      name: values.name,
      email: values.email,
      phone: values.phone,
      ...(values.password ? { password: values.password } : {}),
      ...(hasDemographics
        ? {
            profile: {
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
            },
          }
        : {}),
    };

    const parsed = patientCreateSchema.safeParse(payload);
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
      const result = await apiSend<
        ItemResponse<{ patient: PatientDto; temporaryPassword?: string }>
      >("/api/patients", "POST", parsed.data);
      const { patient, temporaryPassword } = result.data;
      onSaved(patient);
      if (temporaryPassword) {
        setCreatedPassword(temporaryPassword);
      } else {
        showSuccess("Patient created", `${patient.name} has been added.`);
        onClose();
      }
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

  if (createdPassword) {
    return (
      <Modal
        open={open}
        onClose={() => {
          if (!submitting) onClose();
        }}
        title="Patient created"
        description="Share this temporary password with the patient. It is shown once and cannot be retrieved again."
        dismissible={!submitting}
        footer={
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        }
      >
        <div
          className="rounded-control border border-warning-line bg-warning-soft px-3.5 py-3 text-sm text-ink"
          data-testid="temporary-password-panel"
        >
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-muted">
            Temporary password
          </p>
          <p className="font-mono text-base font-semibold break-all text-ink">
            {createdPassword}
          </p>
          <p className="mt-2 text-xs text-ink-muted">
            The patient can sign in with their email and this password, then
            change it from their profile later. For their security, this value
            is never shown again.
          </p>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title="Add patient"
      description="Create a patient account with optional demographics. Leave the password blank to generate a temporary one."
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
          <Button type="submit" form="patient-create-form" loading={submitting}>
            Create patient
          </Button>
        </>
      }
    >
      <form id="patient-create-form" onSubmit={handleSubmit} noValidate>
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
            label="Full name"
            name="name"
            required
            autoComplete="name"
            value={values.name}
            onChange={(event) => update("name", event.target.value)}
            error={errors.name}
            containerClassName="sm:col-span-2"
          />

          <Input
            label="Email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={values.email}
            onChange={(event) => update("email", event.target.value)}
            error={errors.email}
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
            label="Password (optional)"
            name="password"
            type="password"
            autoComplete="new-password"
            value={values.password}
            onChange={(event) => update("password", event.target.value)}
            error={errors.password}
            hint="Blank = server generates a temporary password shown once."
            containerClassName="sm:col-span-2"
          />

          <Input
            label="Date of birth"
            name="dateOfBirth"
            type="date"
            value={values.dateOfBirth}
            onChange={(event) => update("dateOfBirth", event.target.value)}
            error={errors["profile.dateOfBirth"]}
          />

          <Select
            label="Gender"
            name="gender"
            value={values.gender}
            onChange={(event) => update("gender", event.target.value)}
            options={GENDER_OPTIONS}
            error={errors["profile.gender"]}
          />

          <Select
            label="Blood group"
            name="bloodGroup"
            value={values.bloodGroup}
            onChange={(event) => update("bloodGroup", event.target.value)}
            options={BLOOD_GROUP_OPTIONS}
            error={errors["profile.bloodGroup"]}
          />

          <Input
            label="Address line 1"
            name="addressLine1"
            value={values.addressLine1}
            onChange={(event) => update("addressLine1", event.target.value)}
            error={errors["profile.address.line1"]}
          />

          <Input
            label="Address line 2"
            name="addressLine2"
            value={values.addressLine2}
            onChange={(event) => update("addressLine2", event.target.value)}
            error={errors["profile.address.line2"]}
          />

          <Input
            label="City"
            name="city"
            value={values.city}
            onChange={(event) => update("city", event.target.value)}
            error={errors["profile.address.city"]}
          />

          <Input
            label="State"
            name="state"
            value={values.state}
            onChange={(event) => update("state", event.target.value)}
            error={errors["profile.address.state"]}
          />

          <Input
            label="Pincode"
            name="pincode"
            value={values.pincode}
            onChange={(event) => update("pincode", event.target.value)}
            error={errors["profile.address.pincode"]}
          />

          <Input
            label="Emergency contact name"
            name="emergencyName"
            value={values.emergencyName}
            onChange={(event) => update("emergencyName", event.target.value)}
            error={errors["profile.emergencyContact.name"]}
          />

          <Input
            label="Emergency contact phone"
            name="emergencyPhone"
            type="tel"
            value={values.emergencyPhone}
            onChange={(event) => update("emergencyPhone", event.target.value)}
            error={errors["profile.emergencyContact.phone"]}
          />

          <Input
            label="Emergency contact relationship"
            name="emergencyRelationship"
            value={values.emergencyRelationship}
            onChange={(event) =>
              update("emergencyRelationship", event.target.value)
            }
            error={errors["profile.emergencyContact.relationship"]}
          />

          <Input
            label="Staff notes"
            name="notes"
            value={values.notes}
            onChange={(event) => update("notes", event.target.value)}
            error={errors["profile.notes"]}
            hint="Visible to staff only - never shown to the patient."
            containerClassName="sm:col-span-2"
          />
        </div>
      </form>
    </Modal>
  );
}
