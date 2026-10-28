import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { PatientSelfEditor } from "@/components/patients/patient-self-editor";
import { formatDateTime } from "@/components/bookings/shared";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LOGIN_ROUTE } from "@/config/auth";
import { ROLES, roleLabel } from "@/config/roles";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "My Profile",
};

/**
 * Read-only account profile (`/profile`).
 *
 * Everything shown comes from the verified session user (`getCurrentUser`),
 * so no new API endpoint or model query is needed and no other account's data
 * can ever appear here. The (dashboard) layout has already proven the cookie;
 * the extra guard keeps the page safe if it is ever moved.
 */
export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="My profile"
        description="Your account details as registered on the platform."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "My profile" },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-sm text-ink-muted">Name</dt>
                <dd className="min-w-0 truncate text-sm font-medium text-ink">
                  {user.name}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-sm text-ink-muted">Role</dt>
                <dd>
                  <Badge variant="primary" size="sm">
                    {roleLabel(user.role)}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-sm text-ink-muted">Member since</dt>
                <dd className="min-w-0 text-sm font-medium text-ink">
                  {formatDateTime(user.createdAt)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-sm text-ink-muted">Email</dt>
                <dd className="min-w-0 truncate text-sm font-medium text-ink">
                  {user.email}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-sm text-ink-muted">Phone</dt>
                <dd className="min-w-0 truncate text-sm font-medium text-ink">
                  {user.phone ?? "Not provided"}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      {user.role === ROLES.PATIENT ? (
        <div className="mt-4">
          <PatientSelfEditor />
        </div>
      ) : null}
    </>
  );
}
