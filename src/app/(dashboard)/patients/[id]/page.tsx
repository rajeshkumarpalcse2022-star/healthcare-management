import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { PatientDetail } from "@/components/patients/patient-detail";
import { getDashboardRouteForRole, LOGIN_ROUTE } from "@/config/auth";
import { ROLES } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";
import { patientIdSchema } from "@/lib/validation/patient";

export const metadata: Metadata = {
  title: "Patient details",
};

/** Roles allowed to open the patient detail surface (mirrors the API). */
const PATIENT_DIRECTORY_ROLES: readonly string[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.LAB_MANAGER,
  ROLES.STAFF,
];

const PATIENT_MANAGEMENT_ROLES: readonly string[] = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
];

/**
 * Patient detail route. The id shape is checked here so a malformed URL
 * never reaches the client; record-level authorization happens in the API.
 */
export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!patientIdSchema.safeParse({ id }).success) {
    notFound();
  }

  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (!PATIENT_DIRECTORY_ROLES.includes(user.role)) {
    redirect(getDashboardRouteForRole(user.role));
  }

  return (
    <PatientDetail
      id={id}
      canManage={PATIENT_MANAGEMENT_ROLES.includes(user.role)}
    />
  );
}
