"use client";

import * as React from "react";

import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { IconShieldCheck } from "@/components/icons";
import { apiGet, ApiRequestError } from "@/lib/api/client";
import { canManageLabModule, canViewLabModule } from "@/config/labs";
import type { Role } from "@/config/roles";
import type { ListResponse } from "@/types/api";
import type { Laboratory } from "@/types/laboratory";
import { DepartmentsTab } from "./departments-tab";
import { LaboratoriesTab } from "./laboratories-tab";
import { TestsTab } from "./tests-tab";

type ModuleTab = "laboratories" | "departments" | "tests";

const TABS: { key: ModuleTab; label: string }[] = [
  { key: "laboratories", label: "Laboratories" },
  { key: "departments", label: "Departments" },
  { key: "tests", label: "Tests" },
];

export interface LabsModuleProps {
  role: Role;
  /**
   * Deep-linked section from `?tab=laboratories|departments|tests`.
   * Unknown values fall back to the default laboratories view.
   */
  initialTab?: ModuleTab;
}

/**
 * Lab / LIMS module root.
 *
 * Authorization is decided from the server-provided role and re-enforced by
 * every API call; this component only shapes the UI to match. Roles that
 * cannot access the module see an explicit notice rather than a broken form.
 */
export function LabsModule({ role, initialTab = "laboratories" }: LabsModuleProps) {
  const [tab, setTab] = React.useState<ModuleTab>(initialTab);

  const managed = canManageLabModule(role);
  const viewable = canViewLabModule(role);

  // Shared laboratory directory used by the department picker, the test
  // filters and the test form - refreshed whenever a lab record changes.
  const [labsKey, setLabsKey] = React.useState(0);
  const [labsPayload, setLabsPayload] = React.useState<{
    key: number;
    laboratories: Laboratory[];
    error: string | null;
  } | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    apiGet<ListResponse<Laboratory>>("/api/laboratories?status=all&limit=50")
      .then((result) => {
        if (cancelled) return;
        setLabsPayload({
          key: labsKey,
          laboratories: result.data,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLabsPayload({
          key: labsKey,
          laboratories: [],
          error:
            error instanceof ApiRequestError
              ? error.message
              : "Unable to load the laboratory list.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [labsKey]);

  const reloadLaboratories = React.useCallback(() => {
    setLabsKey((value) => value + 1);
  }, []);

  const labsLoaded = labsPayload?.key === labsKey;
  const laboratories = labsPayload?.laboratories ?? [];
  const laboratoriesError = labsLoaded
    ? (labsPayload?.error ?? null)
    : null;

  if (!viewable) {
    return (
      <>
        <PageHeader
          eyebrow="Laboratory"
          title="Lab / LIMS"
          description="Laboratories, departments and the test catalogue."
          breadcrumbs={[
            { label: "Dashboard", href: "/dashboard" },
            { label: "Lab / LIMS" },
          ]}
        />
        <Card>
          <CardContent>
            <EmptyState
              icon={IconShieldCheck}
              title="No access to this module"
              description="You do not have permission to view the lab module. Contact your administrator if you believe this is a mistake."
            />
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Laboratory"
        title="Lab / LIMS"
        description="Manage laboratories, their departments and the test catalogue with ordered parameters."
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Lab / LIMS" },
        ]}
        actions={
          <div
            role="tablist"
            aria-label="Lab / LIMS sections"
            className="inline-flex rounded-control border border-border bg-surface p-1"
          >
            {TABS.map((item) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={tab === item.key}
                onClick={() => setTab(item.key)}
                className={
                  "rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 " +
                  (tab === item.key
                    ? "bg-primary-light text-primary-active dark:bg-primary-muted dark:text-brand-300"
                    : "text-ink-muted hover:bg-surface-muted hover:text-ink")
                }
              >
                {item.label}
              </button>
            ))}
          </div>
        }
      />

      {tab === "laboratories" ? (
        <LaboratoriesTab
          managed={managed}
          onDirectoryChanged={reloadLaboratories}
        />
      ) : tab === "departments" ? (
        <DepartmentsTab
          laboratories={laboratories}
          laboratoriesError={laboratoriesError}
          managed={managed}
          onGoToLaboratories={() => setTab("laboratories")}
          onDirectoryChanged={reloadLaboratories}
        />
      ) : (
        <TestsTab
          laboratories={laboratories}
          laboratoriesError={laboratoriesError}
          managed={managed}
          onDirectoryChanged={reloadLaboratories}
        />
      )}
    </>
  );
}
