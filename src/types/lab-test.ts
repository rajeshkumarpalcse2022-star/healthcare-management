import type { ParameterDataType } from "@/config/labs";
import type { LabDepartmentRef } from "@/types/lab-department";
import type { LaboratoryRef } from "@/types/laboratory";

/** Catalogue entry for a lab test - the public DTO shape. */
export interface LabTest {
  id: string;
  laboratory: LaboratoryRef | null;
  department: LabDepartmentRef | null;
  name: string;
  /** Business code, unique within the owning laboratory. */
  code: string;
  category: string;
  specimenType: string;
  methodology: string | null;
  turnaroundTimeMinutes: number;
  description: string | null;
  preparationInstructions: string | null;
  price: number;
  /** Patient may visit the laboratory to provide the sample. */
  labVisitEnabled: boolean;
  /** A collector may visit the patient's home to collect the sample. */
  homeCollectionEnabled: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Structured reference range - covers numeric bounds, free-text ranges
 * (e.g. "Negative") and enum guidance, so future result validation can be
 * driven from data instead of hard-coded rules.
 */
export interface ReferenceRange {
  low: number | null;
  high: number | null;
  text: string | null;
}

/** Measurable parameter of a lab test - the public DTO shape. */
export interface LabTestParameter {
  id: string;
  labTestId: string;
  name: string;
  code: string;
  dataType: ParameterDataType;
  unit: string | null;
  referenceRange: ReferenceRange | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  displayOrder: number;
  isRequired: boolean;
  createdAt: string;
  updatedAt: string;
}
