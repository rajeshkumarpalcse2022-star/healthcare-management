"use client";

import * as React from "react";

import { useRouter } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { SkeletonCard } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import {
  PATIENT_BLOOD_GROUP_LABELS,
  PATIENT_GENDER_LABELS,
} from "@/config/patients";
import { ApiRequestError, apiGet, apiSend } from "@/lib/api/client";
import type { PatientDto } from "@/lib/patient/dto";
import type { ItemResponse } from "@/types/api";

import { PatientProfileModal } from "./patient-profile-modal";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString();
}

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleString();
}

function genderLabel(value: string | null): string {
  if (!value) return "Not specified";
  return (
    PATIENT_GENDER_LABELS[value as keyof typeof PATIENT_GENDER_LABELS] ??
    value
  );
}

function bloodGroupLabel(value: string | null): string {
  if (!value) return "Not specified";
  return (
    PATIENT_BLOOD_GROUP_LABELS[
      value as keyof typeof PATIENT_BLOOD_GROUP_LABELS
    ] ?? value
  );
}

interface PatientDetailProps {
  id: string;
  /** ADMIN / SUPER_ADMIN may edit demographics and toggle record status. */
  canManage: boolean;
}

/**
 * Patient detail surface for `/patients/[id]` (staff view). Loads
 * `GET /api/patients/[id]`; ADMIN/SUPER_ADMIN additionally get the edit
 * dialog and activate/deactivate actions.
 */
export function PatientDetail({ id, canManage }: PatientDetailProps) {
  const router = useRouter();
  const { success: showSuccess } = useToast();
  const [patient, setPatient] = React.useState<PatientDto | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [loadError, setLoadError] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [reloadTick, setReloadTick] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    apiGet<ItemResponse<PatientDto>>(`/api/patients/${id}`)
      .then((result) => {
        if (cancelled) return;
        setPatient(result.data);
        setLoadError("");
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoadError(
          error instanceof ApiRequestError
            ? error.message
            : "This patient could not be loaded.",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, reloadTick]);

  const toggleStatus = async () => {
    if (!patient) return;
    try {
      const result = await apiSend<ItemResponse<PatientDto>>(
        `/api/patients/${patient.id}/status`,
        "PATCH",
        { isActive: !patient.profile.isActive },
      );
      setPatient(result.data);
      showSuccess(
        "Record status updated",
        result.data.profile.isActive
          ? `${result.data.name} is active again.`
          : `${result.data.name}'s record is deactivated.`,
      );
    } catch {
      setReloadTick((tick) => tick + 1);
    }
  };

  if (loading) {
    return <SkeletonCard className="mt-6" />;
  }

  if (loadError || !patient) {
    return (
      <div className="mt-6">
        <ErrorState
          title="Patient could not be loaded"
          description={loadError || "This patient does not exist."}
          onRetry={() => {
            setLoading(true);
            setLoadError("");
            setReloadTick((tick) => tick + 1);
          }}
        />
      </div>
    );
  }

  const { profile } = patient;

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => router.push("/patients")}
        >
          Back to patients
        </Button>
        {canManage ? (
          <span className="inline-flex flex-wrap gap-2">
            <Button type="button" onClick={() => setEditing(true)}>
              {profile.hasProfile ? "Edit profile" : "Add profile"}
            </Button>
            <Button type="button" variant="outline" onClick={toggleStatus}>
              {profile.isActive ? "Deactivate record" : "Activate record"}
            </Button>
          </span>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-sm text-ink-muted">Name</dt>
                <dd className="min-w-0 truncate text-sm font-medium text-ink">
                  {patient.name}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-sm text-ink-muted">Email</dt>
                <dd className="min-w-0 truncate text-sm font-medium text-ink">
                  {patient.email}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-sm text-ink-muted">Phone</dt>
                <dd className="min-w-0 truncate text-sm font-medium text-ink">
                  {patient.phone ?? "Not provided"}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-sm text-ink-muted">
                  Record status
                </dt>
                <dd>
                  <Badge
                    variant={profile.isActive ? "success" : "warning"}
                    size="sm"
                  >
                    {profile.isActive ? "Active" : "Deactivated"}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-sm text-ink-muted">
                  Login account
                </dt>
                <dd>
                  <Badge
                    variant={patient.accountActive ? "success" : "warning"}
                    size="sm"
                  >
                    {patient.accountActive ? "Enabled" : "Disabled"}
                  </Badge>
                </dd>
              </div>
              <div className="flex items-start justify-between gap-3">
                <dt className="shrink-0 text-sm text-ink-muted">
                  Member since
                </dt>
                <dd className="min-w-0 text-sm font-medium text-ink">
                  {formatDateTime(patient.createdAt)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Demographics</CardTitle>
          </CardHeader>
          <CardContent>
            {profile.hasProfile ? (
              <dl className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <dt className="shrink-0 text-sm text-ink-muted">
                    Date of birth
                  </dt>
                  <dd className="min-w-0 text-sm font-medium text-ink">
                    {formatDate(profile.dateOfBirth)}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="shrink-0 text-sm text-ink-muted">Gender</dt>
                  <dd className="min-w-0 text-sm font-medium text-ink">
                    {genderLabel(profile.gender)}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="shrink-0 text-sm text-ink-muted">
                    Blood group
                  </dt>
                  <dd className="min-w-0 text-sm font-medium text-ink">
                    {bloodGroupLabel(profile.bloodGroup)}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="shrink-0 text-sm text-ink-muted">Address</dt>
                  <dd className="min-w-0 text-right text-sm font-medium text-ink">
                    {profile.address ? (
                      <>
                        <span className="block">
                          {profile.address.line1}
                          {profile.address.line2
                            ? `, ${profile.address.line2}`
                            : ""}
                        </span>
                        <span className="block">
                          {profile.address.city}, {profile.address.state}{" "}
                          {profile.address.pincode}
                        </span>
                      </>
                    ) : (
                      "Not provided"
                    )}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="shrink-0 text-sm text-ink-muted">
                    Emergency contact
                  </dt>
                  <dd className="min-w-0 text-right text-sm font-medium text-ink">
                    {profile.emergencyContact ? (
                      <>
                        <span className="block">
                          {profile.emergencyContact.name}
                          {profile.emergencyContact.relationship
                            ? ` (${profile.emergencyContact.relationship})`
                            : ""}
                        </span>
                        <span className="block">
                          {profile.emergencyContact.phone}
                        </span>
                      </>
                    ) : (
                      "Not provided"
                    )}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="shrink-0 text-sm text-ink-muted">
                    Last updated
                  </dt>
                  <dd className="min-w-0 text-sm font-medium text-ink">
                    {formatDateTime(profile.updatedAt)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-ink-muted">
                No profile yet. This account was created before Patient
                Management shipped - open the edit dialog to add demographics.
              </p>
            )}
          </CardContent>
        </Card>

        {canManage ? (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle>Staff notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-ink">
                {profile.notes?.trim()
                  ? profile.notes
                  : "No clinical notes recorded."}
              </p>
              <p className="mt-2 text-xs text-ink-muted">
                Staff-only remarks - never included in patient self-views.
              </p>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <PatientProfileModal
        patient={editing ? patient : null}
        onClose={() => setEditing(false)}
        onSaved={(saved) => setPatient(saved)}
      />
    </>
  );
}
