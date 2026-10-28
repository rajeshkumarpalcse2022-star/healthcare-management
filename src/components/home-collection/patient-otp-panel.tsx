"use client";

import * as React from "react";

import { IconRefresh } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { apiSend, ApiRequestError } from "@/lib/api/client";
import type { ItemResponse } from "@/types/api";
import type { HomeCollectionDetail } from "@/types/home-collection";

export interface PatientOtpPanelProps {
  collectionId: string;
  /** OTP metadata from the detail response (never the plaintext). */
  otp: HomeCollectionDetail["otp"];
  onRegenerated: () => void;
}

/**
 * Patient-side pickup OTP recovery panel.
 *
 * The plaintext OTP is only ever returned by the regenerate call and is
 * shown exactly once inside this panel - it is never persisted in state
 * beyond the render, never logged. Before regeneration the panel shows the
 * current expiry / remaining attempts from the detail response so the
 * patient can tell whether they still need a fresh code. The server
 * enforces ownership, status and the cooldown regardless of what is shown.
 */
export function PatientOtpPanel({
  collectionId,
  otp,
  onRegenerated,
}: PatientOtpPanelProps) {
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [freshOtp, setFreshOtp] = React.useState<string | null>(null);
  const [freshExpiresAt, setFreshExpiresAt] = React.useState<string | null>(null);
  const [expired, setExpired] = React.useState(false);

  const expiresAt = otp?.expiresAt ?? null;
  React.useEffect(() => {
    if (!expiresAt) return;
    const timer = window.setTimeout(() => {
      setExpired(new Date(expiresAt).getTime() < Date.now());
    }, 0);
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  const locked = otp !== null && otp.attemptsRemaining <= 0;
  const verified = otp?.verified === true;
  // `expired` only ever applies while an expiry timestamp exists.
  const isExpired = expiresAt !== null && expired;

  async function handleRegenerate() {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiSend<
        ItemResponse<HomeCollectionDetail & { collectionOtp?: string; collectionOtpExpiresAt?: string }>
      >(`/api/home-collections/${collectionId}/regenerate-otp`, "POST", {});
      setFreshOtp(response.data.collectionOtp ?? null);
      setFreshExpiresAt(response.data.collectionOtpExpiresAt ?? null);
      onRegenerated();
    } catch (err) {
      setError(
        err instanceof ApiRequestError
          ? err.message
          : "Unable to generate a new OTP. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (verified) {
    return (
      <div className="rounded-control border border-success-line bg-success-soft p-3.5 text-sm text-success">
        Pickup verified — this OTP has already been used to complete the
        collection.
      </div>
    );
  }

  return (
    <div className="rounded-control border border-border bg-surface-muted p-3.5">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        Pickup OTP
      </p>

      {freshOtp ? (
        <div className="mt-2 rounded-control border border-info-line bg-info-soft px-4 py-3 text-center">
          <p className="font-mono text-3xl font-bold tracking-[0.3em] text-ink">
            {freshOtp}
          </p>
          <p className="mt-1.5 text-xs text-ink-subtle">
            Share this code with the collector when they arrive. It was shown
            only once — write it down or screenshot it now.
            {freshExpiresAt
              ? ` Valid until ${new Date(freshExpiresAt).toLocaleString()}.`
              : ""}
          </p>
        </div>
      ) : (
        <div className="mt-2 space-y-1 text-sm text-ink-muted">
          {isExpired || locked ? (
            <p className="text-danger">
              {locked
                ? "Too many incorrect attempts — generate a new code."
                : "This OTP has expired — generate a new code."}
            </p>
          ) : (
            <p>
              Your OTP is hidden for security. If you lost or forgot it,
              generate a new one — the old code stops working immediately.
            </p>
          )}
          {otp?.expiresAt && !isExpired ? (
            <p className="text-xs text-ink-subtle">
              Expires: {new Date(otp.expiresAt).toLocaleString()} ·{" "}
              {otp.attemptsRemaining} attempt
              {otp.attemptsRemaining === 1 ? "" : "s"} remaining
            </p>
          ) : null}
        </div>
      )}

      {error ? (
        <p
          role="alert"
          className="mt-2 rounded-control border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}

      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        loading={loading}
        onClick={() => void handleRegenerate()}
      >
        <IconRefresh className="size-4" />
        {freshOtp ? "Generate another OTP" : "Generate new OTP"}
      </Button>
    </div>
  );
}
