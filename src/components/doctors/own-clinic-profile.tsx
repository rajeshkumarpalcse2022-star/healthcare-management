"use client";

import * as React from "react";

import {
  IconBuilding,
  IconMapPin,
  IconPencil,
  IconRefresh,
} from "@/components/icons";
import { EntityAvatar } from "@/components/shared/entity-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { apiGet, ApiRequestError } from "@/lib/api/client";
import { googleMapsUrl, hasMapLocation } from "@/lib/utils/location";
import type { ItemResponse } from "@/types/api";
import type { Clinic } from "@/types/clinic";
import { ClinicFormModal } from "./clinic-form-modal";
import { statusBadge } from "./shared";

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="shrink-0 text-sm text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-words text-sm font-medium text-ink">
        {value}
      </dd>
    </div>
  );
}

function locationLine(clinic: Clinic): string {
  const parts = [clinic.city, clinic.state, clinic.pincode].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0 ? parts.join(", ") : "Not provided";
}

/**
 * Clinic profile for the DOCTOR role.
 *
 * Reads `/api/doctors/me/clinic`, which resolves the clinic from the caller's
 * linked Doctor profile rather than a client-supplied id. Doctors may update
 * contact and location details; clinic code, status and assignment remain
 * administrator-managed.
 */
export function OwnClinicProfile() {
  const [refreshKey, setRefreshKey] = React.useState(0);
  const [editOpen, setEditOpen] = React.useState(false);
  const requestKey = `own-clinic|${refreshKey}`;

  const [payload, setPayload] = React.useState<{
    requestKey: string;
    clinic: Clinic | null;
    error: string | null;
    notFound: boolean;
  } | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    apiGet<ItemResponse<Clinic>>("/api/doctors/me/clinic")
      .then((result) => {
        if (cancelled) return;
        setPayload({
          requestKey,
          clinic: result.data,
          error: null,
          notFound: false,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPayload({
          requestKey,
          clinic: null,
          error:
            error instanceof ApiRequestError
              ? error.message
              : "Unable to load your clinic details.",
          notFound: error instanceof ApiRequestError && error.status === 404,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [requestKey]);

  const loading = payload === null || payload.requestKey !== requestKey;
  const clinic = payload?.clinic ?? null;
  const error = payload?.error ?? null;
  const notFound = payload?.notFound ?? false;

  if (loading) {
    return (
      <Card>
        <CardContent className="p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <Skeleton className="size-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
          </div>
          <div className="mt-6 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-4 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (notFound) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={IconBuilding}
            title="No clinic assigned"
            description={
              error ??
              "Your doctor profile is not linked to a clinic yet. Contact an administrator to assign one."
            }
          />
        </CardContent>
      </Card>
    );
  }

  if (error || !clinic) {
    return (
      <ErrorState
        title="Unable to load your clinic"
        description={error ?? "Please try again."}
        onRetry={() => setRefreshKey((value) => value + 1)}
      />
    );
  }

  const badge = statusBadge(clinic.isActive);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <EntityAvatar
            src={clinic.imageUrl}
            alt={clinic.name}
            fallback={<IconBuilding className="size-6" />}
            className="size-12"
            sizes="48px"
          />
          <div className="min-w-0">
            <CardTitle className="text-lg">{clinic.name}</CardTitle>
            <p className="mt-1 text-sm text-ink-muted">Clinic details</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={badge.variant} dot>
                {badge.label}
              </Badge>
              <Badge variant="primary" size="sm">
                {clinic.code}
              </Badge>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => setEditOpen(true)}>
            <IconPencil className="size-4" />
            Edit clinic
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            <IconRefresh className="size-4" />
            Refresh
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <dl className="divide-y divide-border">
          <DetailRow label="Clinic code" value={clinic.code} />
          <DetailRow label="Email" value={clinic.email ?? "Not provided"} />
          <DetailRow label="Phone" value={clinic.phone ?? "Not provided"} />
          <DetailRow label="Address" value={clinic.address ?? "Not provided"} />
          <DetailRow label="Location" value={locationLine(clinic)} />
          <DetailRow
            label="Map location"
            value={
              hasMapLocation(clinic) ? (
                <a
                  href={googleMapsUrl(clinic.latitude, clinic.longitude)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-primary hover:underline"
                >
                  <IconMapPin className="size-3.5" aria-hidden="true" />
                  Open in Google Maps
                </a>
              ) : (
                "Not captured"
              )
            }
          />
          <DetailRow
            label="Registration number"
            value={clinic.registrationNumber ?? "Not provided"}
          />
        </dl>

        <p className="mt-5 flex items-center gap-2 text-xs text-ink-subtle">
          <IconBuilding className="size-3.5" aria-hidden="true" />
          Clinic code, active status and doctor assignment are managed by an
          administrator.
        </p>
      </CardContent>

      <ClinicFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        clinic={clinic}
        selfEdit
        onSaved={(saved) => {
          setEditOpen(false);
          setPayload((current) =>
            current
              ? { ...current, clinic: saved, error: null, notFound: false }
              : {
                  requestKey,
                  clinic: saved,
                  error: null,
                  notFound: false,
                },
          );
        }}
      />
    </Card>
  );
}
