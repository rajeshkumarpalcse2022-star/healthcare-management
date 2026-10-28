"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { apiSend, ApiRequestError } from "@/lib/api/client";
import {
  departmentCreateSchema,
  departmentUpdateSchema,
} from "@/lib/validation/lab-department";
import { toFieldIssues } from "@/lib/validation/common";
import type { ItemResponse } from "@/types/api";
import type { LabDepartment } from "@/types/lab-department";
import { issuesToErrors, type FieldErrors } from "./shared";

interface DepartmentFormValues {
  name: string;
  code: string;
  description: string;
}

const EMPTY_VALUES: DepartmentFormValues = {
  name: "",
  code: "",
  description: "",
};

function toFormValues(department?: LabDepartment | null): DepartmentFormValues {
  if (!department) return { ...EMPTY_VALUES };
  return {
    name: department.name,
    code: department.code,
    description: department.description ?? "",
  };
}

export interface DepartmentFormModalProps {
  open: boolean;
  onClose: () => void;
  /** The laboratory that owns the department (create context or display). */
  laboratory: { id: string; name: string; code: string } | null;
  /** `null` / omitted → create mode. */
  department?: LabDepartment | null;
  onSaved: (department: LabDepartment) => void;
}

/**
 * Create / edit lab department dialog. The owning laboratory is fixed by the
 * caller - departments are always created inside a selected laboratory.
 */
export function DepartmentFormModal({
  open,
  onClose,
  laboratory,
  department,
  onSaved,
}: DepartmentFormModalProps) {
  const isEdit = Boolean(department);
  const { success: showSuccess } = useToast();
  const [values, setValues] = React.useState<DepartmentFormValues>(() =>
    toFormValues(department),
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
      setValues(toFormValues(department));
      setErrors({});
      setFormError(null);
      setSubmitting(false);
    }
  }

  function update<K extends keyof DepartmentFormValues>(
    key: K,
    value: DepartmentFormValues[K],
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
    if (submitting || !laboratory) return;

    const payload = isEdit
      ? values
      : { ...values, laboratoryId: laboratory.id };
    const schema = isEdit ? departmentUpdateSchema : departmentCreateSchema;
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
      const url = isEdit
        ? `/api/lab-departments/${department!.id}`
        : `/api/laboratories/${laboratory.id}/departments`;
      const method = isEdit ? "PATCH" : "POST";
      const result = await apiSend<ItemResponse<LabDepartment>>(
        url,
        method,
        parsed.data,
      );
      showSuccess(
        isEdit ? "Department updated" : "Department created",
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
      title={isEdit ? "Edit department" : "Add department"}
      description={
        laboratory
          ? isEdit
            ? `Update the department details for ${laboratory.name}.`
            : `Create a new department inside ${laboratory.name}.`
          : "Select a laboratory first."
      }
      dismissible={!submitting}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="department-form" loading={submitting}>
            {isEdit ? "Save changes" : "Create department"}
          </Button>
        </>
      }
    >
      <form id="department-form" onSubmit={handleSubmit} noValidate>
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
            label="Department name"
            name="name"
            required
            value={values.name}
            onChange={(event) => update("name", event.target.value)}
            error={errors.name}
            containerClassName="sm:col-span-2"
            placeholder="e.g. Hematology"
          />

          <Input
            label="Department code"
            name="code"
            required
            value={values.code}
            onChange={(event) => update("code", event.target.value)}
            error={errors.code}
            hint="Unique within this laboratory, e.g. HEM-01"
            placeholder="HEM-01"
          />

          <div className="hidden sm:block" aria-hidden="true" />

          <Textarea
            label="Description"
            name="description"
            value={values.description}
            onChange={(event) => update("description", event.target.value)}
            error={errors.description}
            containerClassName="sm:col-span-2"
            placeholder="What this department covers (optional)"
          />
        </div>
      </form>
    </Modal>
  );
}
