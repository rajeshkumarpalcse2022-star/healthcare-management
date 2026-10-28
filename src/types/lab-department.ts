import type { LaboratoryRef } from "@/types/laboratory";

/** Lab department record - the public DTO shape. */
export interface LabDepartment {
  id: string;
  laboratory: LaboratoryRef | null;
  name: string;
  /** Business code, unique within the owning laboratory. */
  code: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Minimal department reference used on test records. */
export interface LabDepartmentRef {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}
