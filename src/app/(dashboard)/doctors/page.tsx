import type { Metadata } from "next";

import { DoctorsModule } from "@/components/doctors/doctors-module";
import { getCurrentUser } from "@/lib/auth";
import type { SafeUser } from "@/types/auth";

export const metadata: Metadata = {
  title: "Doctor / Clinic",
};

/**
 * Doctor / Clinic management entry point.
 *
 * The (dashboard) layout has already verified the session; this page simply
 * reads the same server-side user to shape the client UI. Authorization for
 * every data action is enforced again inside the API routes.
 */
export default async function DoctorsPage() {
  const user: SafeUser | null = await getCurrentUser();

  return <DoctorsModule role={user?.role ?? "PATIENT"} />;
}
