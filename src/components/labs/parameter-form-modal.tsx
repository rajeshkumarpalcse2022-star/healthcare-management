"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import {
  PARAMETER_DATA_TYPES,
  PARAMETER_DATA_TYPE_LABELS,
} from "@/config/labs";
import { apiSend, ApiRequestError } from "@/lib/api/client";
import {
  parameterCreateSchema,
  parameterUpdateSchema,
} from "@/lib/validation/lab-test-parameter";
import { toFieldIssues } from "@/lib/validation/common";
import type { ItemResponse } from "@/types/api";
import type { LabTestParameter } from "@/types/lab-test";
import { issuesToErrors, type FieldErrors } from "./shared";

interface ParameterFormValues {
  name: string;
  code: string;
  dataType: string;
  unit: string;
  referenceLow: string;
  referenceHigh: string;
  referenceText: string;
  criticalLow: string;
  criticalHigh: string;
  isRequired: boolean;
}

const EMPTY_VALUES: ParameterFormValues = {
  name: "",
  code: "",
  dataType: "",
  unit: "",
  referenceLow: "",
  referenceHigh: "",
  referenceText: "",
  criticalLow: "",
  criticalHigh: "",
  isRequired: true,
};

function toFormValues(
  parameter?: LabTestParameter | null,
): ParameterFormValues {
  if (!parameter) return { ...EMPTY_VALUES };
  const range = parameter.referenceRange;
  return {
    name: parameter.name,
    code: parameter.code,
    dataType: parameter.dataType,
    unit: parameter.unit ?? "",
    referenceLow:
      typeof range?.low === "number" ? String(range.low) : "",
    referenceHigh:
      typeof range?.high === "number" ? String(range.high) : "",
    referenceText: range?.text ?? "",
    criticalLow:
      typeof parameter.criticalLow === "number"
        ? String(parameter.criticalLow)
        : "",
    criticalHigh:
      typeof parameter.criticalHigh === "number"
        ? String(parameter.criticalHigh)
        : "",
    isRequired: parameter.isRequired,
  };
}

/**
 * Builds the request body. Blank strings reach the Zod schemas as-is, where
 * `clearableNumber` turns them into `null` (clear) and `optionalText` does
 * the same for strings - omitted keys are never sent, so updates leave
 * untouched fields alone. Reference text is normalised to `null` explicitly
 * because the schema accepts plain strings.
 */
function toPayload(values: ParameterFormValues) {
  const payload: Record<string, unknown> = {
    name: values.name,
    code: values.code,
    dataType: values.dataType,
    unit: values.unit,
    referenceRange: {
      low: values.referenceLow,
      high: values.referenceHigh,
      text:
        values.referenceText.trim() === "" ? null : values.referenceText,
    },
    criticalLow: values.criticalLow,
    criticalHigh: values.criticalHigh,
    isRequired: values.isRequired,
  };
  return payload;
}

const dataTypeOptions = PARAMETER_DATA_TYPES.map((value) => ({
  value,
  label: PARAMETER_DATA_TYPE_LABELS[value],
}));

export interface ParameterFormModalProps {
  open: boolean;
  onClose: () => void;
  labTestId: string;
  /** `null` / omitted → create mode. */
  parameter?: LabTestParameter | null;
  onSaved: (parameter: LabTestParameter) => void;
}

/**
 * Create / edit lab test parameter dialog. Parameters always belong to the
 * test whose detail page opened this dialog - the owning test is never a
 * picker, it is fixed by the caller.
 */
export function ParameterFormModal({
  open,
  onClose,
  labTestId,
  parameter,
  onSaved,
}: ParameterFormModalProps) {
  const isEdit = Boolean(parameter);
  const { success: showSuccess } = useToast();
  const [values, setValues] = React.useState<ParameterFormValues>(() =>
    toFormValues(parameter),
  );
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [formError, setFormError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // Reset the form whenever the dialog opens (render-phase adjustment).
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setValues(toFormValues(parameter));
      setErrors({});
      setFormError(null);
      setSubmitting(false);
    }
  }

  function update<K extends keyof ParameterFormValues>(
    key: K,
    value: ParameterFormValues[K],
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

    const body = {
      ...toPayload(values),
      ...(isEdit ? {} : { labTestId }),
    };
    const schema = isEdit ? parameterUpdateSchema : parameterCreateSchema;
    const parsed = schema.safeParse(body);

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
        ? `/api/lab-test-parameters/${parameter!.id}`
        : `/api/lab-tests/${labTestId}/parameters`;
      const method = isEdit ? "PATCH" : "POST";
      const result = await apiSend<ItemResponse<LabTestParameter>>(
        url,
        method,
        parsed.data,
      );
      showSuccess(
        isEdit ? "Parameter updated" : "Parameter added",
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
      title={isEdit ? "Edit parameter" : "Add parameter"}
      description={
        isEdit
          ? "Update this measured parameter and its reference rules."
          : "Define a measurable value reported with this test."
      }
      dismissible={!submitting}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="parameter-form" loading={submitting}>
            {isEdit ? "Save changes" : "Add parameter"}
          </Button>
        </>
      }
    >
      <form id="parameter-form" onSubmit={handleSubmit} noValidate>
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
            label="Parameter name"
            name="name"
            required
            value={values.name}
            onChange={(event) => update("name", event.target.value)}
            error={errors.name}
            containerClassName="sm:col-span-2"
            placeholder="e.g. Hemoglobin"
          />

          <Input
            label="Parameter code"
            name="code"
            required
            value={values.code}
            onChange={(event) => update("code", event.target.value)}
            error={errors.code}
            hint="Unique within this test, e.g. HGB"
            placeholder="HGB"
          />

          <Select
            label="Data type"
            name="dataType"
            required
            value={values.dataType}
            onChange={(event) => update("dataType", event.target.value)}
            options={[{ value: "", label: "Select a data type" }, ...dataTypeOptions]}
            error={errors.dataType}
            hint="How results will be captured for this parameter."
          />

          <Input
            label="Unit"
            name="unit"
            value={values.unit}
            onChange={(event) => update("unit", event.target.value)}
            error={errors.unit}
            placeholder="e.g. g/dL (optional)"
          />

          <div className="hidden sm:block" aria-hidden="true" />

          <fieldset className="sm:col-span-2">
            <legend className="mb-1 text-sm font-medium text-ink">
              Reference range
            </legend>
            <p className="mb-2 text-xs text-ink-muted">
              Numeric bounds, a text range (e.g. Negative), or both. Leave
              blank when not applicable.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Input
                aria-label="Reference low value"
                name="referenceLow"
                type="number"
                value={values.referenceLow}
                onChange={(event) => update("referenceLow", event.target.value)}
                error={errors["referenceRange.low"]}
                placeholder="Low"
              />
              <Input
                aria-label="Reference high value"
                name="referenceHigh"
                type="number"
                value={values.referenceHigh}
                onChange={(event) => update("referenceHigh", event.target.value)}
                error={errors["referenceRange.high"]}
                placeholder="High"
              />
              <Input
                aria-label="Reference text"
                name="referenceText"
                value={values.referenceText}
                onChange={(event) => update("referenceText", event.target.value)}
                error={errors["referenceRange.text"]}
                placeholder="e.g. Negative"
              />
            </div>
          </fieldset>

          <Input
            label="Critical low"
            name="criticalLow"
            type="number"
            value={values.criticalLow}
            onChange={(event) => update("criticalLow", event.target.value)}
            error={errors.criticalLow}
            hint="Alert threshold below this value"
            placeholder="e.g. 7"
          />

          <Input
            label="Critical high"
            name="criticalHigh"
            type="number"
            value={values.criticalHigh}
            onChange={(event) => update("criticalHigh", event.target.value)}
            error={errors.criticalHigh}
            hint="Alert threshold above this value"
            placeholder="e.g. 20"
          />

          <label className="flex cursor-pointer items-center gap-2.5 rounded-control border border-border bg-canvas px-3 py-2.5 sm:col-span-2">
            <input
              type="checkbox"
              name="isRequired"
              checked={values.isRequired}
              onChange={(event) => update("isRequired", event.target.checked)}
              className="size-4 rounded-xs border-border text-primary accent-primary"
            />
            <span className="text-sm text-ink">Required parameter</span>
            <span className="text-xs text-ink-muted">
              Must be reported before results can be validated.
            </span>
          </label>
        </div>
      </form>
    </Modal>
  );
}
