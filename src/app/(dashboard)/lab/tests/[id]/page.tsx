import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { LabTestDetail } from "@/components/labs/test-detail";
import { labTestIdSchema } from "@/lib/validation/lab-test";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Lab test details",
};

/**
 * Lab test detail route. The id shape is checked here so a malformed URL
 * never reaches the client; record-level authorization happens in the API.
 */
export default async function LabTestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!labTestIdSchema.safeParse({ id }).success) {
    notFound();
  }

  const user = await getCurrentUser();

  return <LabTestDetail id={id} role={user?.role ?? "PATIENT"} />;
}
