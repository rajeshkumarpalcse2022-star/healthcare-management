"use client";

import * as React from "react";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconShieldCheck } from "@/components/icons";
import { apiGet, ApiRequestError } from "@/lib/api/client";
import {
  canManageModule,
  canViewModule,
  isDoctorRole,
} from "@/config/doctors";
import type { Role } from "@/config/roles";
import type { ListResponse } from "@/types/api";
import type { Clinic } from "@/types/clinic";
import { ClinicsTab } from "./clinics-tab";
import { DoctorsTab } from "./doctors-tab";
import { OwnClinicProfile } from "./own-clinic-profile";
import { OwnDoctorProfile } from "./own-doctor-profile";

type ModuleTab = "doctors" | "clinics";

export interface DoctorsModuleProps {
  role: Role;
}

/**
 * Doctor / Clinic module root.
 *
 * Authorization is decided from the server-provided role and re-enforced by
 * every API call; this component only shapes the UI to match. Roles that
 * cannot access the module see an explicit notice rather than a broken form.
 */
export function DoctorsModule({ role }: DoctorsModuleProps) {
  const [tab, setTab] = React.useState<ModuleTab>("doctors");
  const [clinicOptions, setClinicOptions] = React.useState<
    { value: string; label: string }[]
  >([]);
  const [clinicsError, setClinicsError] = React.useState<string | null>(null);
  const [clinicsLoaded, setClinicsLoaded] = React.useState(false);

  const managed = canManageModule(role);
  const doctorRole = isDoctorRole(role);
  const viewable = canViewModule(role);

  const [clinicsKey, setClinicsKey] = React.useState(0);

  React.useEffect(() => {
    if (!managed) return;
    let cancelled = false;

    apiGet<ListResponse<Clinic>>("/api/clinics?status=active&limit=50")
      .then((result) => {
        if (cancelled) return;
        setClinicOptions(
          result.data.map((clinic) => ({
            value: clinic.id,
            label: `${clinic.name} (${clinic.code})`,
          })),
        );
        setClinicsError(null);
        setClinicsLoaded(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setClinicOptions([]);
        setClinicsError(
          error instanceof ApiRequestError
            ? error.message
            : "Unable to load the clinic list.",
        );
        setClinicsLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [managed, clinicsKey]);

  const reloadClinics = React.useCallback(() => {
    setClinicsKey((value) => value + 1);
  }, []);

  if (!viewable) {
    return (
      <>
        <PageHeader
          eyebrow="Doctor / Clinic"
          title="Doctor / Clinic"
          description="Doctors and clinics directory"
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Doctor / Clinic" },
          ]}
        />
        <Card>
          <CardContent>
            <EmptyState
              icon={IconShieldCheck}
              title="No access to this module"
              description="You do not have permission to manage doctors and clinics. Contact your administrator if you believe this is a mistake."
            />
          </CardContent>
        </Card>
      </>
    );
  }

  if (doctorRole) {
    const isDoctorTab = tab === "doctors";

    return (
      <>
        <PageHeader
          eyebrow="Clinical"
          title={isDoctorTab ? "My Doctor Profile" : "My Clinic"}
          description={
            isDoctorTab
              ? "Your professional profile as recorded in the doctor directory."
              : "Contact and location details for the clinic assigned to you."
          }
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Doctor / Clinic" },
            { label: isDoctorTab ? "My profile" : "My clinic" },
          ]}
          actions={
            <div
              role="tablist"
              aria-label="Doctor / Clinic sections"
              className="inline-flex rounded-control border border-border bg-surface p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={isDoctorTab}
                onClick={() => setTab("doctors")}
                className={
                  "rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 " +
                  (isDoctorTab
                    ? "bg-primary-light text-primary-active dark:bg-primary-muted dark:text-brand-300"
                    : "text-ink-muted hover:bg-surface-muted hover:text-ink")
                }
              >
                Doctor
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={!isDoctorTab}
                onClick={() => setTab("clinics")}
                className={
                  "rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 " +
                  (!isDoctorTab
                    ? "bg-primary-light text-primary-active dark:bg-primary-muted dark:text-brand-300"
                    : "text-ink-muted hover:bg-surface-muted hover:text-ink")
                }
              >
                Clinic
              </button>
            </div>
          }
        />
        {isDoctorTab ? <OwnDoctorProfile /> : <OwnClinicProfile />}
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Clinical"
        title="Doctor / Clinic"
        description="Manage clinics and doctor profiles from a single directory."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Doctor / Clinic" },
        ]}
        actions={
          <div
            role="tablist"
            aria-label="Doctor / Clinic sections"
            className="inline-flex rounded-control border border-border bg-surface p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === "doctors"}
              onClick={() => setTab("doctors")}
              className={
                "rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 " +
                (tab === "doctors"
                  ? "bg-primary-light text-primary-active dark:bg-primary-muted dark:text-brand-300"
                  : "text-ink-muted hover:bg-surface-muted hover:text-ink")
              }
            >
              Doctors
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "clinics"}
              onClick={() => setTab("clinics")}
              className={
                "rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 " +
                (tab === "clinics"
                  ? "bg-primary-light text-primary-active dark:bg-primary-muted dark:text-brand-300"
                  : "text-ink-muted hover:bg-surface-muted hover:text-ink")
              }
            >
              Clinics
            </button>
          </div>
        }
      />

      {tab === "doctors" ? (
        <DoctorsTab
          clinicOptions={clinicOptions}
          clinicsError={clinicsLoaded ? clinicsError : null}
          onDirectoryChanged={() => {
            reloadClinics();
          }}
        />
      ) : (
        <ClinicsTab
          onDirectoryChanged={() => {
            reloadClinics();
          }}
        />
      )}
    </>
  );
}
