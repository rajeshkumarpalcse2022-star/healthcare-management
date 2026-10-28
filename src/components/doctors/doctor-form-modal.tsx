"use client";

import * as React from "react";

import { IconStethoscope } from "@/components/icons";
import { ImageUploadField } from "@/components/shared/image-upload-field";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { APPOINTMENT_MAX_CLINICS_PER_DOCTOR } from "@/config/appointments";
import { apiSend, ApiRequestError } from "@/lib/api/client";
import {
  doctorCreateSchema,
  doctorSelfUpdateSchema,
  doctorUpdateSchema,
} from "@/lib/validation/doctor";
import { toFieldIssues } from "@/lib/validation/common";
import {
  DOCTOR_GENDERS,
  DOCTOR_GENDER_LABELS,
  SPECIALIZATIONS,
} from "@/config/doctors";
import type { ItemResponse } from "@/types/api";
import type { Doctor } from "@/types/doctor";
import { issuesToErrors, type FieldErrors } from "./shared";

interface DoctorFormValues {
  name: string;
  email: string;
  phone: string;
  specialization: string;
  clinicId: string;
  clinicIds: string[];
  doctorCode: string;
  qualification: string;
  registrationNumber: string;
  experienceYears: string;
  consultationFee: string;
  gender: string;
  dateOfBirth: string;
  bio: string;
  profileImageUrl: string;
}

const EMPTY_VALUES: DoctorFormValues = {
  name: "",
  email: "",
  phone: "",
  specialization: "",
  clinicId: "",
  clinicIds: [],
  doctorCode: "",
  qualification: "",
  registrationNumber: "",
  experienceYears: "",
  consultationFee: "",
  gender: "",
  dateOfBirth: "",
  bio: "",
  profileImageUrl: "",
};

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function toFormValues(doctor?: Doctor | null): DoctorFormValues {
  if (!doctor) return { ...EMPTY_VALUES };
  return {
    name: doctor.name,
    email: doctor.email,
    phone: doctor.phone ?? "",
    specialization: doctor.specialization,
    clinicId: doctor.clinic?.id ?? "",
    clinicIds:
      doctor.clinics.length > 0
        ? doctor.clinics.map((clinic) => clinic.id)
        : doctor.clinic
          ? [doctor.clinic.id]
          : [],
    doctorCode: doctor.doctorCode,
    qualification: doctor.qualification ?? "",
    registrationNumber: doctor.registrationNumber ?? "",
    experienceYears:
      doctor.experienceYears === null ? "" : String(doctor.experienceYears),
    consultationFee:
      doctor.consultationFee === null ? "" : String(doctor.consultationFee),
    gender: doctor.gender ?? "",
    dateOfBirth: toDateInputValue(doctor.dateOfBirth),
    bio: doctor.bio ?? "",
    profileImageUrl: doctor.profileImageUrl ?? "",
  };
}

/** Prepares the Zod payload: blank optional numbers/enum/date collapse to undefined. */
function toPayload(values: DoctorFormValues) {
  const clinicIds =
    values.clinicIds.length > 0
      ? values.clinicIds
      : values.clinicId
        ? [values.clinicId]
        : [];
  return {
    ...values,
    clinicId: clinicIds[0] ?? "",
    clinicIds,
    experienceYears:
      values.experienceYears.trim() === ""
        ? undefined
        : Number(values.experienceYears),
    consultationFee:
      values.consultationFee.trim() === ""
        ? undefined
        : Number(values.consultationFee),
    gender: values.gender === "" ? undefined : values.gender,
    dateOfBirth:
      values.dateOfBirth.trim() === "" ? undefined : values.dateOfBirth,
  };
}

export interface DoctorFormModalProps {
  open: boolean;
  onClose: () => void;
  /** `null` / omitted -> create mode. */
  doctor?: Doctor | null;
  /** Active clinic options for the clinic picker. */
  clinicOptions?: { value: string; label: string }[];
  clinicsError?: string | null;
  /**
   * Doctor editing their own profile: only professional fields are shown and
   * submitted to the self-service endpoint. Clinic, doctor code and account
   * linking stay administrator-managed.
   */
  selfEdit?: boolean;
  onSaved: (doctor: Doctor) => void;
}

const specializationOptions = [
  { value: "", label: "Select a specialization" },
  ...SPECIALIZATIONS.map((value) => ({ value, label: value })),
];

const genderOptions = [
  { value: "", label: "Select gender" },
  ...DOCTOR_GENDERS.map((value) => ({
    value,
    label: DOCTOR_GENDER_LABELS[value],
  })),
];

/**
 * Create / edit doctor dialog.
 *
 * The clinic picker is fed by the clinic directory API; if that request
 * fails the form still renders with an inline error so the failure is clear
 * rather than silent.
 */
export function DoctorFormModal({
  open,
  onClose,
  doctor,
  clinicOptions = [],
  clinicsError,
  selfEdit = false,
  onSaved,
}: DoctorFormModalProps) {
  const isEdit = Boolean(doctor);
  const isSelfEdit = selfEdit && isEdit;
  const [values, setValues] = React.useState<DoctorFormValues>(() =>
    toFormValues(doctor),
  );
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Reset the form whenever the dialog opens. Render-phase adjustment keeps
  // stale values from the previous record from leaking into the next edit.
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setValues(toFormValues(doctor));
      setErrors({});
      setFormError(null);
      setSubmitting(false);
    }
  }

  function update<K extends keyof DoctorFormValues>(
    key: K,
    value: DoctorFormValues[K],
  ) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key as string]) return current;
      const next = { ...current };
      delete next[key as string];
      return next;
    });
  }

  function toggleClinic(clinicId: string) {
    setValues((current) => {
      const selected = current.clinicIds.includes(clinicId);
      const clinicIds = selected
        ? current.clinicIds.filter((id) => id !== clinicId)
        : [...current.clinicIds, clinicId];
      return { ...current, clinicIds, clinicId: clinicIds[0] ?? "" };
    });
    setErrors((current) => {
      const next = { ...current };
      delete next.clinicId;
      delete next.clinicIds;
      return next;
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const payload = toPayload(values);
    const schema = isSelfEdit
      ? doctorSelfUpdateSchema
      : isEdit
        ? doctorUpdateSchema
        : doctorCreateSchema;
    const parsed = schema.safeParse(payload);

    if (!parsed.success) {
      setErrors(
        toFieldIssues(parsed.error).reduce<FieldErrors>((acc, issue) => {
          if (!acc[issue.field]) acc[issue.field] = issue.message;
          return acc;
        }, {}),
      );
      setFormError(null);
      return;
    }

    setSubmitting(true);
    setErrors({});
    setFormError(null);

    try {
      const url = isSelfEdit
        ? "/api/doctors/me"
        : isEdit
          ? `/api/doctors/${doctor!.id}`
          : "/api/doctors";
      const method = isEdit ? "PATCH" : "POST";
      const result = await apiSend<ItemResponse<Doctor>>(
        url,
        method,
        parsed.data,
      );
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

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!submitting) onClose();
      }}
      title={
        isSelfEdit ? "Edit my profile" : isEdit ? "Edit doctor" : "Add doctor"
      }
      description={
        isSelfEdit
          ? "Update your professional details. Clinic assignment, doctor code and account status stay with the administrator."
          : isEdit
            ? "Update the doctor profile and clinic assignments below."
            : "Create a doctor profile and assign one or more clinics."
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
          <Button
            type="submit"
            form="doctor-form"
            loading={submitting}
          >
            {isEdit ? "Save changes" : "Create doctor"}
          </Button>
        </>
      }
    >
      <form id="doctor-form" onSubmit={handleSubmit} noValidate>
        {formError ? (
          <div
            role="alert"
            className="mb-4 rounded-control border border-danger-line bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
          >
            {formError}
          </div>
        ) : null}

        <ImageUploadField
          kind="doctor"
          label="Profile photo"
          description="This photo is shown to patients and staff across the platform."
          value={values.profileImageUrl || null}
          onChange={(url) => update("profileImageUrl", url ?? "")}
          fallback={<IconStethoscope className="size-8" />}
          className="mb-5"
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input
            label="Full name"
            name="name"
            required
            autoComplete="name"
            value={values.name}
            onChange={(event) => update("name", event.target.value)}
            error={errors.name}
            placeholder="Dr. Jane Doe"
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
            placeholder="doctor@example.com"
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

          <Select
            label="Specialization"
            name="specialization"
            required
            value={values.specialization}
            onChange={(event) => update("specialization", event.target.value)}
            error={errors.specialization}
            options={specializationOptions}
          />

          {isSelfEdit ? null : (
            <>
              <div className="sm:col-span-2">
                <p className="form-label">
                  Clinics <span className="text-danger">*</span>
                </p>
                <p className="form-hint">
                  Select every clinic this doctor practises at. The first
                  selected clinic is the primary clinic.
                </p>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {clinicOptions.map((option) => {
                    const selected = values.clinicIds.includes(option.value);
                    return (
                      <label
                        key={option.value}
                        className="flex cursor-pointer items-center gap-2 rounded-control border border-border bg-surface px-3 py-2 text-sm text-ink"
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={
                            !selected &&
                            values.clinicIds.length >=
                              APPOINTMENT_MAX_CLINICS_PER_DOCTOR
                          }
                          onChange={() => toggleClinic(option.value)}
                          className="size-4 accent-[#10B981]"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {option.label}
                        </span>
                        {values.clinicIds[0] === option.value ? (
                          <span className="text-xs font-medium text-primary">
                            Primary
                          </span>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
                {clinicOptions.length === 0 ? (
                  <p className="mt-2 text-sm text-ink-muted">
                    No active clinics are available.
                  </p>
                ) : null}
                {errors.clinicIds || errors.clinicId ? (
                  <p className="form-error" role="alert">
                    {errors.clinicIds ?? errors.clinicId}
                  </p>
                ) : null}
              </div>

              <Input
                label="Doctor code"
                name="doctorCode"
                required
                value={values.doctorCode}
                onChange={(event) => update("doctorCode", event.target.value)}
                error={errors.doctorCode}
                hint="Unique code, e.g. DR-0001"
                placeholder="DR-0001"
              />
            </>
          )}

          <Input
            label="Registration number"
            name="registrationNumber"
            value={values.registrationNumber}
            onChange={(event) => update("registrationNumber", event.target.value)}
            error={errors.registrationNumber}
            placeholder="Medical council registration"
          />

          <Input
            label="Qualification"
            name="qualification"
            value={values.qualification}
            onChange={(event) => update("qualification", event.target.value)}
            error={errors.qualification}
            placeholder="MBBS, MD"
          />

          <Select
            label="Gender"
            name="gender"
            value={values.gender}
            onChange={(event) => update("gender", event.target.value)}
            error={errors.gender}
            options={genderOptions}
          />

          <Input
            label="Experience (years)"
            name="experienceYears"
            type="number"
            min={0}
            max={60}
            value={values.experienceYears}
            onChange={(event) => update("experienceYears", event.target.value)}
            error={errors.experienceYears}
            placeholder="e.g. 8"
          />

          <Input
            label="Consultation fee"
            name="consultationFee"
            type="number"
            min={0}
            step={50}
            value={values.consultationFee}
            onChange={(event) => update("consultationFee", event.target.value)}
            error={errors.consultationFee}
            hint="Amount in local currency"
            placeholder="e.g. 500"
          />

          <Input
            label="Date of birth"
            name="dateOfBirth"
            type="date"
            value={values.dateOfBirth}
            onChange={(event) => update("dateOfBirth", event.target.value)}
            error={errors.dateOfBirth}
          />

          <Textarea
            label="Bio"
            name="bio"
            value={values.bio}
            onChange={(event) => update("bio", event.target.value)}
            error={errors.bio}
            placeholder="Short professional summary (optional)"
            containerClassName="sm:col-span-2"
          />
        </div>

        {clinicsError && !isSelfEdit ? (
          <p className="form-error mt-3" role="alert">
            {clinicsError}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
