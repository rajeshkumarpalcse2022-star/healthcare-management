"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { SPECIMEN_TYPES, TEST_CATEGORIES } from "@/config/labs";
import { apiSend, ApiRequestError } from "@/lib/api/client";
import {
  labTestCreateSchema,
  labTestUpdateSchema,
} from "@/lib/validation/lab-test";
import { toFieldIssues } from "@/lib/validation/common";
import type { ItemResponse } from "@/types/api";
import type { LabTest } from "@/types/lab-test";
import type { Laboratory } from "@/types/laboratory";
import { useDepartmentOptions } from "./use-department-options";
import { issuesToErrors, type FieldErrors } from "./shared";

interface LabTestFormValues {
  laboratoryId: string;
  departmentId: string;
  name: string;
  code: string;
  category: string;
  specimenType: string;
  methodology: string;
  turnaroundTimeMinutes: string;
  price: string;
  description: string;
  preparationInstructions: string;
  labVisitEnabled: boolean;
  homeCollectionEnabled: boolean;
}

const EMPTY_VALUES: LabTestFormValues = {
  laboratoryId: "",
  departmentId: "",
  name: "",
  code: "",
  category: "",
  specimenType: "",
  methodology: "",
  turnaroundTimeMinutes: "",
  price: "",
  description: "",
  preparationInstructions: "",
  labVisitEnabled: true,
  homeCollectionEnabled: true,
};

function toFormValues(test?: LabTest | null): LabTestFormValues {
  if (!test) return { ...EMPTY_VALUES };
  return {
    laboratoryId: test.laboratory?.id ?? "",
    departmentId: test.department?.id ?? "",
    name: test.name,
    code: test.code,
    category: test.category,
    specimenType: test.specimenType,
    methodology: test.methodology ?? "",
    turnaroundTimeMinutes: String(test.turnaroundTimeMinutes),
    price: String(test.price),
    description: test.description ?? "",
    preparationInstructions: test.preparationInstructions ?? "",
    labVisitEnabled: test.labVisitEnabled ?? true,
    homeCollectionEnabled: test.homeCollectionEnabled ?? true,
  };
}

/** Blank optional numbers collapse to `undefined` (leave unchanged). */
function toPayload(values: LabTestFormValues) {
  return {
    ...values,
    turnaroundTimeMinutes:
      values.turnaroundTimeMinutes.trim() === ""
        ? undefined
        : Number(values.turnaroundTimeMinutes),
    price: values.price.trim() === "" ? undefined : Number(values.price),
  };
}

const categoryOptions = [
  { value: "", label: "Select a category" },
  ...TEST_CATEGORIES.map((value) => ({ value, label: value })),
];

const specimenOptions = [
  { value: "", label: "Select a specimen type" },
  ...SPECIMEN_TYPES.map((value) => ({ value, label: value })),
];

export interface LabTestFormModalProps {
  open: boolean;
  onClose: () => void;
  /** `null` / omitted → create mode. */
  test?: LabTest | null;
  laboratories: Laboratory[];
  onSaved: (test: LabTest) => void;
}

/**
 * Create / edit lab test dialog. The department dropdown always lists only
 * the departments of the selected laboratory, so a department from another
 * laboratory can never be chosen.
 */
export function LabTestFormModal({
  open,
  onClose,
  test,
  laboratories,
  onSaved,
}: LabTestFormModalProps) {
  const isEdit = Boolean(test);
  const { success: showSuccess } = useToast();
  const [values, setValues] = React.useState<LabTestFormValues>(() =>
    toFormValues(test),
  );
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const departments = useDepartmentOptions(values.laboratoryId);

  // Reset the form whenever the dialog opens. Render-phase adjustment keeps
  // stale values from the previous record from leaking into the next edit.
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setValues(toFormValues(test));
      setErrors({});
      setFormError(null);
      setSubmitting(false);
    }
  }

  const laboratoryOptions = [
    { value: "", label: "Select a laboratory" },
    ...laboratories.map((laboratory) => ({
      value: laboratory.id,
      label: laboratory.isActive
        ? `${laboratory.name} (${laboratory.code})`
        : `${laboratory.name} (${laboratory.code}) - inactive`,
      disabled: !laboratory.isActive,
    })),
  ];

  const departmentOptions = [
    {
      value: "",
      label: values.laboratoryId
        ? departments.loading
          ? "Loading departments..."
          : "Select a department"
        : "Select a laboratory first",
    },
    ...departments.options.map((department) => ({
      value: department.id,
      label: department.isActive
        ? `${department.name} (${department.code})`
        : `${department.name} (${department.code}) - inactive`,
      disabled: !department.isActive,
    })),
  ];

  function update<K extends keyof LabTestFormValues>(
    key: K,
    value: LabTestFormValues[K],
  ) {
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

    // Clean messages for the two required relationship pickers before Zod.
    const pickerErrors: FieldErrors = {};
    if (!values.laboratoryId) {
      pickerErrors.laboratoryId = "Select a laboratory.";
    }
    if (!values.departmentId) {
      pickerErrors.departmentId = "Select a department.";
    }
    if (Object.keys(pickerErrors).length > 0) {
      setErrors(pickerErrors);
      setFormError(null);
      return;
    }

    const schema = isEdit ? labTestUpdateSchema : labTestCreateSchema;
    const parsed = schema.safeParse(toPayload(values));

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
      const url = isEdit ? `/api/lab-tests/${test!.id}` : "/api/lab-tests";
      const method = isEdit ? "PATCH" : "POST";
      const result = await apiSend<ItemResponse<LabTest>>(
        url,
        method,
        parsed.data,
      );
      showSuccess(
        isEdit ? "Lab test updated" : "Lab test created",
        `${result.data.name} has been saved.`,
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
      title={isEdit ? "Edit lab test" : "Add lab test"}
      description={
        isEdit
          ? "Update the test catalogue entry below."
          : "Add a new test to the laboratory catalogue."
      }
      size="lg"
      dismissible={!submitting}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="lab-test-form" loading={submitting}>
            {isEdit ? "Save changes" : "Create test"}
          </Button>
        </>
      }
    >
      <form id="lab-test-form" onSubmit={handleSubmit} noValidate>
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
            label="Test name"
            name="name"
            required
            value={values.name}
            onChange={(event) => update("name", event.target.value)}
            error={errors.name}
            containerClassName="sm:col-span-2"
            placeholder="e.g. Complete Blood Count (CBC)"
          />

          <Input
            label="Test code"
            name="code"
            required
            value={values.code}
            onChange={(event) => update("code", event.target.value)}
            error={errors.code}
            hint="Unique within the selected laboratory, e.g. CBC-01"
            placeholder="CBC-01"
          />

          <Input
            label="Price"
            name="price"
            type="number"
            min={0}
            step="0.01"
            required
            value={values.price}
            onChange={(event) => update("price", event.target.value)}
            error={errors.price}
            placeholder="e.g. 450"
          />

          <Select
            label="Laboratory"
            name="laboratoryId"
            required
            value={values.laboratoryId}
            onChange={(event) => {
              // Department must always belong to the selected laboratory,
              // so clear it whenever the laboratory changes.
              setValues((current) => ({
                ...current,
                laboratoryId: event.target.value,
                departmentId: "",
              }));
              setErrors((current) => {
                const next = { ...current };
                delete next.laboratoryId;
                delete next.departmentId;
                return next;
              });
            }}
            options={laboratoryOptions}
            error={errors.laboratoryId}
          />

          <Select
            label="Department"
            name="departmentId"
            required
            value={values.departmentId}
            onChange={(event) => update("departmentId", event.target.value)}
            options={departmentOptions}
            error={errors.departmentId}
            hint={
              departments.error
                ? undefined
                : "Departments are limited to the selected laboratory."
            }
          />

          <Select
            label="Category"
            name="category"
            required
            value={values.category}
            onChange={(event) => update("category", event.target.value)}
            options={categoryOptions}
            error={errors.category}
          />

          <Select
            label="Specimen type"
            name="specimenType"
            required
            value={values.specimenType}
            onChange={(event) => update("specimenType", event.target.value)}
            options={specimenOptions}
            error={errors.specimenType}
          />

          <Input
            label="Turnaround time"
            name="turnaroundTimeMinutes"
            type="number"
            min={0}
            required
            value={values.turnaroundTimeMinutes}
            onChange={(event) =>
              update("turnaroundTimeMinutes", event.target.value)
            }
            error={errors.turnaroundTimeMinutes}
            hint="Minutes until results are expected"
            placeholder="e.g. 120"
          />

          <Input
            label="Methodology"
            name="methodology"
            value={values.methodology}
            onChange={(event) => update("methodology", event.target.value)}
            error={errors.methodology}
            placeholder="e.g. Flow cytometry (optional)"
          />

          <Textarea
            label="Description"
            name="description"
            value={values.description}
            onChange={(event) => update("description", event.target.value)}
            error={errors.description}
            containerClassName="sm:col-span-2"
            placeholder="What the test measures (optional)"
          />

          <Textarea
            label="Preparation instructions"
            name="preparationInstructions"
            value={values.preparationInstructions}
            onChange={(event) =>
              update("preparationInstructions", event.target.value)
            }
            error={errors.preparationInstructions}
            containerClassName="sm:col-span-2"
            placeholder="Patient preparation, e.g. 12-hour fasting (optional)"
          />

          <div className="sm:col-span-2 rounded-control border border-border bg-surface-muted p-4">
            <p className="text-sm font-semibold text-ink">
              Sample collection methods
            </p>
            <p className="mt-0.5 text-xs text-ink-muted">
              Choose how patients can provide the sample for this test. At
              least one method must stay enabled.
            </p>
            <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  name="lab-visit-enabled"
                  checked={values.labVisitEnabled}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    if (!checked && !values.homeCollectionEnabled) return;
                    update("labVisitEnabled", checked);
                  }}
                  className="size-4 accent-[#10B981]"
                />
                Lab visit
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink">
                <input
                  type="checkbox"
                  name="home-collection-enabled"
                  checked={values.homeCollectionEnabled}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    if (!checked && !values.labVisitEnabled) return;
                    update("homeCollectionEnabled", checked);
                  }}
                  className="size-4 accent-[#10B981]"
                />
                Home collection
              </label>
            </div>
            {!values.labVisitEnabled && !values.homeCollectionEnabled ? (
              <p className="mt-2 text-xs text-danger">
                At least one collection method must remain enabled.
              </p>
            ) : null}
          </div>
        </div>

        {departments.error ? (
          <p role="alert" className="form-error mt-3">
            {departments.error}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
