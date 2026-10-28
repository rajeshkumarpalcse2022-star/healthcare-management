import type { Metadata } from "next";

import { LabsModule } from "@/components/labs/labs-module";
import { getCurrentUser } from "@/lib/auth";
import type { SafeUser } from "@/types/auth";

export const metadata: Metadata = {
  title: "Lab / LIMS",
};

const TAB_VALUES = ["laboratories", "departments", "tests"] as const;

/**
 * Lab / LIMS management entry point.
 *
 * The (dashboard) layout has already verified the session; this page simply
 * reads the same server-side user to shape the client UI. Authorization for
 * every data action is enforced again inside the API routes. `?tab=` deep
 * links (used by the lab-manager dashboard's "Lab Tests" shortcut) are
 * validated against the known sections before they reach the client.
 */
export default async function LabPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user: SafeUser | null = await getCurrentUser();
  const { tab } = await searchParams;
  const initialTab = TAB_VALUES.find((value) => value === tab);

  return (
    <LabsModule role={user?.role ?? "PATIENT"} initialTab={initialTab} />
  );
}
