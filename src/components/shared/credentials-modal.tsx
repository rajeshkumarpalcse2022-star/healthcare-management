"use client";

import * as React from "react";

import { IconCopy, IconAlertTriangle } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { ProvisionedCredentials } from "@/types/auth";

export interface CredentialsModalProps {
  open: boolean;
  onClose: () => void;
  credentials: ProvisionedCredentials | null;
  /** e.g. "Doctor" or "Laboratory" - shown in the title. */
  subjectLabel: string;
}

/**
 * One-time credentials dialog shown after an administrator provisions a
 * doctor or laboratory account. The plain-text password exists only in this
 * response - the modal makes that clear and offers a copy action.
 */
export function CredentialsModal({
  open,
  onClose,
  credentials,
  subjectLabel,
}: CredentialsModalProps) {
  const [copied, setCopied] = React.useState<"id" | "password" | null>(null);

  // Reset the copied indicator whenever the dialog reopens (render-phase
  // adjustment - same pattern as the form modals).
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setCopied(null);
  }

  async function copy(value: string, which: "id" | "password") {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard may be blocked - the values remain selectable above.
    }
  }

  if (!credentials) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${subjectLabel} login credentials`}
      description="Share these with the account owner. The password is shown only once."
      size="md"
      footer={
        <Button onClick={onClose}>I have saved these</Button>
      }
    >
      <div className="space-y-4">
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-control border border-warning-line bg-warning-soft px-3.5 py-3 text-sm font-medium text-warning"
        >
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p className="min-w-0 leading-relaxed">
            Copy these credentials now - the password cannot be retrieved again
            after you close this dialog.
          </p>
        </div>

        <div className="space-y-3">
          <div className="rounded-control border border-border bg-surface-muted px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
              Unique ID
            </p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <code className="font-mono text-base font-semibold tracking-wide text-ink">
                {credentials.uniqueId}
              </code>
              <button
                type="button"
                onClick={() => void copy(credentials.uniqueId, "id")}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink"
              >
                <IconCopy className="size-3.5" />
                {copied === "id" ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          <div className="rounded-control border border-border bg-surface-muted px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">
              Password
            </p>
            <div className="mt-1 flex items-center justify-between gap-3">
              <code className="font-mono text-base font-semibold tracking-wide text-ink">
                {credentials.password}
              </code>
              <button
                type="button"
                onClick={() => void copy(credentials.password, "password")}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-ink-muted transition-colors hover:bg-surface hover:text-ink"
              >
                <IconCopy className="size-3.5" />
                {copied === "password" ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        </div>

        <p className="text-xs text-ink-subtle">
          The owner can sign in with these credentials and optionally change
          them later from their profile.
        </p>
      </div>
    </Modal>
  );
}
