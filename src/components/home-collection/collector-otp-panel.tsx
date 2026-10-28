"use client";

import * as React from "react";

import { IconShieldCheck } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { COLLECTION_OTP_PATTERN } from "@/config/home-collection";

export interface CollectorOtpPanelProps {
  collectionId: string;
  attemptsRemaining: number | null;
  onCompleted: () => void;
}

/**
 * Collector OTP verification panel. Shown only when the assigned collector
 * (or an ops user) views a request in COLLECTOR_ACCEPTED / COLLECTOR_EN_ROUTE
 * / ARRIVED. The patient verbally shares the 6-digit OTP shown once at
 * request creation; submitting it atomically completes the pickup.
 */
export function CollectorOtpPanel({
  collectionId,
  attemptsRemaining,
  onCompleted,
}: CollectorOtpPanelProps) {
  const [otp, setOtp] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;
    const trimmed = otp.trim();
    if (!COLLECTION_OTP_PATTERN.test(trimmed)) {
      setError("Enter the 6-digit OTP shown to the patient.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/home-collections/${collectionId}/verify-otp`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ otp: trimmed }),
        },
      );
      const payload = (await response.json()) as {
        error?: string;
        issues?: { message: string }[];
      };
      if (!response.ok) {
        const message =
          payload.issues?.[0]?.message ??
          payload.error ??
          "Unable to verify the OTP.";
        setError(message);
        return;
      }
      setOtp("");
      onCompleted();
    } catch {
      setError("Unable to verify the OTP. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="rounded-control border border-border bg-surface-muted p-4"
    >
      <div className="flex items-start gap-2.5">
        <IconShieldCheck
          className="mt-0.5 size-4 shrink-0 text-ink-muted"
          aria-hidden="true"
        />
        <div>
          <p className="text-sm font-medium text-ink">Verify pickup OTP</p>
          <p className="mt-0.5 text-xs text-ink-muted">
            Ask the patient for the 6-digit OTP shown on their request. Entering
            it completes the pickup.
            {attemptsRemaining !== null && attemptsRemaining >= 0
              ? ` ${attemptsRemaining} attempt(s) remaining.`
              : ""}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Input
          label="OTP"
          name="collection-otp"
          value={otp}
          onChange={(event) => setOtp(event.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          placeholder="000000"
          className="w-40 font-mono tracking-widest"
          error={error ?? undefined}
        />
        <Button type="submit" loading={loading} disabled={loading}>
          Verify &amp; complete
        </Button>
      </div>
    </form>
  );
}
