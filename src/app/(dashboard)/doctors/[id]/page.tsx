import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DoctorDetail } from "@/components/doctors/doctor-detail";
import { doctorIdSchema } from "@/lib/validation/doctor";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Doctor details",
};

/**
 * Doctor detail route. The id shape is checked here so a malformed URL never
 * reaches the client; record-level authorization happens in the API.
 */
export default async function DoctorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!doctorIdSchema.safeParse({ id }).success) {
    notFound();
  }

  const user = await getCurrentUser();

  return <DoctorDetail id={id} role={user?.role ?? "PATIENT"} />;
}
