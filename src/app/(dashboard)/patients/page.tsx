import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PatientAccounts } from "@/components/patients/patient-accounts";
import { PageHeader } from "@/components/shared/page-header";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { ROLES } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Patients",
};

/** Roles allowed to browse the patient directory (mirrors the patients API). */
const PATIENT_DIRECTORY_ROLES: readonly string[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
];

/** Roles that may create patients and edit/activate records. */
const PATIENT_MANAGEMENT_ROLES: readonly string[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
];

/** Patient directory surface (`/patients`). */
export default async function PatientsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (!PATIENT_DIRECTORY_ROLES.includes(user.role)) {
    redirect(getDashboardRouteForRole(user.role));
  }

  return (
    <>
      <PageHeader
        eyebrow="Clinical"
        title="Patients"
        description="The platform-wide patient directory. Lab managers and staff have read-only access; administrators also create records and edit demographics."
      />
      <PatientAccounts
        canManage={PATIENT_MANAGEMENT_ROLES.includes(user.role)}
      />
    </>
  );
}
