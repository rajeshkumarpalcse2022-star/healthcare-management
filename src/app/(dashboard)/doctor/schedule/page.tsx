import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DoctorScheduleEditor } from "@/components/appointments/doctor-schedule-editor";
import { IconCalendarCheck } from "@/components/icons";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { LOGIN_ROUTE } from "@/config/auth";
import { ROLES } from "@/config/roles";
import {
  doctorClinicIds,
  getDoctorClinicSchedule,
} from "@/lib/appointment/clinic-assignments";
import { toScheduleConfigDto } from "@/lib/appointment/dto";
import { connectToDatabase } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { Clinic } from "@/models/Clinic";
import { Doctor } from "@/models/Doctor";
import type { DoctorClinicScheduleOption } from "@/types/appointment";

export const metadata: Metadata = {
  title: "Availability & Schedule",
};

/**
 * Doctor availability editor (`/doctor/schedule`).
 *
 * The page loads the signed-in doctor's own profile server-side (redirecting
 * to /doctor/pending when there is no active profile) and passes the stored
 * schedule to the client editor, which saves through the same availability
 * endpoint the API tests exercise.
 */
export default async function DoctorSchedulePage() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  if (user.role !== ROLES.DOCTOR) redirect("/dashboard");

  let doctorId: string | null = null;
  let clinics: DoctorClinicScheduleOption[] = [];
  let initialClinicId: string | null = null;
  try {
    await connectToDatabase();
    const doctor = await Doctor.findOne({ userId: user.id, isActive: true })
      .select("clinicId clinicIds clinicSchedules scheduleConfig")
      .lean();
    if (doctor) {
      doctorId = String(doctor._id);
      const clinicIds = doctorClinicIds(doctor);
      const clinicDocs = await Clinic.find({ _id: { $in: clinicIds } })
        .select("name code isActive")
        .lean();
      const byId = new Map(
        clinicDocs.map((clinic) => [String(clinic._id), clinic]),
      );
      clinics = clinicIds.map((clinicId) => {
        const clinic = byId.get(clinicId);
        return {
          id: clinicId,
          name: clinic?.name ?? "Unknown clinic",
          code: clinic?.code ?? "",
          isActive: clinic?.isActive !== false,
          scheduleConfig: toScheduleConfigDto(
            getDoctorClinicSchedule(doctor, clinicId),
          ),
        };
      });
      initialClinicId = clinicIds[0] ?? null;
    }
  } catch {
    doctorId = null;
  }
  if (!doctorId) redirect("/doctor/pending");
  if (!initialClinicId) redirect("/doctor/pending");

  return (
    <>
      <PageHeader
        eyebrow="Appointments"
        title="Availability & schedule"
        description="Set working days, hours, breaks, seat capacity and special dates separately for each clinic. Overlapping hours across clinics are blocked automatically."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Availability & schedule" },
        ]}
        actions={
          <Link href="/doctor/appointments" className="inline-flex">
            <Button variant="outline">
              <IconCalendarCheck className="size-4" />
              Day view
            </Button>
          </Link>
        }
      />
      <DoctorScheduleEditor
        doctorId={doctorId}
        clinics={clinics}
        initialClinicId={initialClinicId}
      />
    </>
  );
}
