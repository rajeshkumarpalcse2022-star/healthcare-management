"use client";

import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WEEKDAY_LABELS } from "@/config/lab-bookings";
import type { Laboratory } from "@/types/laboratory";

export interface LaboratoryDetailsModalProps {
  open: boolean;
  onClose: () => void;
  laboratory: Laboratory | null;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="shrink-0 text-sm text-ink-muted">{label}</dt>
      <dd className="min-w-0 break-words text-sm font-medium text-ink">
        {value}
      </dd>
    </div>
  );
}

/** Read-only detail view for one laboratory record. */
export function LaboratoryDetailsModal({
  open,
  onClose,
  laboratory,
}: LaboratoryDetailsModalProps) {
  return (
    <Modal
      open={open && laboratory !== null}
      onClose={onClose}
      title={laboratory?.name ?? "Laboratory"}
      description="Complete laboratory record as stored in the directory."
      size="lg"
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      {laboratory ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge variant={laboratory.isActive ? "success" : "neutral"} dot>
              {laboratory.isActive ? "Active" : "Inactive"}
            </Badge>
            <Badge variant="primary" size="sm">
              {laboratory.code}
            </Badge>
          </div>

          <dl className="divide-y divide-border">
            <DetailRow label="Name" value={laboratory.name} />
            <DetailRow label="Code" value={laboratory.code} />
            <DetailRow label="Email" value={laboratory.email ?? "—"} />
            <DetailRow label="Phone" value={laboratory.phone ?? "—"} />
            <DetailRow label="Address" value={laboratory.address ?? "—"} />
            <DetailRow label="City" value={laboratory.city ?? "—"} />
            <DetailRow label="State" value={laboratory.state ?? "—"} />
            <DetailRow label="Pincode" value={laboratory.pincode ?? "—"} />
            <DetailRow
              label="Registration number"
              value={laboratory.registrationNumber ?? "—"}
            />
            <DetailRow
              label="Accreditation"
              value={laboratory.accreditation ?? "—"}
            />
            <DetailRow
              label="Created"
              value={new Date(laboratory.createdAt).toLocaleString()}
            />
            <DetailRow
              label="Last updated"
              value={new Date(laboratory.updatedAt).toLocaleString()}
            />
          </dl>

          <div className="mt-5 border-t border-border pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-ink">Online booking</p>
              <Badge
                variant={laboratory.bookingConfig ? "success" : "neutral"}
                dot
              >
                {laboratory.bookingConfig ? "Configured" : "Not configured"}
              </Badge>
            </div>
            {laboratory.bookingConfig ? (
              <dl className="mt-2 divide-y divide-border">
                <DetailRow
                  label="Timezone"
                  value={laboratory.bookingConfig.timezone}
                />
                <DetailRow
                  label="Operating days"
                  value={laboratory.bookingConfig.operatingDays
                    .slice()
                    .sort((a, b) => a - b)
                    .map((day) => WEEKDAY_LABELS[day]?.slice(0, 3) ?? String(day))
                    .join(", ")}
                />
                <DetailRow
                  label="Hours"
                  value={`${laboratory.bookingConfig.openingTime} – ${laboratory.bookingConfig.closingTime}`}
                />
                <DetailRow
                  label="Slot"
                  value={`${laboratory.bookingConfig.slotDurationMinutes} min · ${laboratory.bookingConfig.slotCapacity} booking(s) per slot`}
                />
                <DetailRow
                  label="Advance window"
                  value={`${laboratory.bookingConfig.maxAdvanceDays} day(s)`}
                />
              </dl>
            ) : (
              <p className="mt-1.5 text-sm text-ink-muted">
                No schedule saved. Availability queries report this laboratory
                as unavailable for online booking until one is configured.
              </p>
            )}
          </div>
        </>
      ) : null}
    </Modal>
  );
}
