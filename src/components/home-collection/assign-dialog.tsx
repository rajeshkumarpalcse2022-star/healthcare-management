"use client";

import * as React from "react";

import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Select } from "@/components/ui/select";
import { apiGet, ApiRequestError } from "@/lib/api/client";
import type { ListResponse } from "@/types/api";
import type { CollectorOption } from "@/types/home-collection";

export interface CollectorAssignDialogProps {
  open: boolean;
  collectionCode: string;
  /** Current collector id, preselected in the picker when present. */
  currentCollectorId?: string | null;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onConfirm: (collectorId: string) => void;
}

/**
 * Collector assignment / reassignment picker.
 *
 * The collector directory is fetched from the role-restricted collectors
 * endpoint; the dialog only ever offers active COLLECTOR accounts the server
 * returned. The chosen collector is keyed-payload state (same pattern as
 * `useApiList`): loading and stale data are derived from whether the cached
 * payload matches the current open-session key, so no setState runs
 * synchronously inside the effect body. Blocks interaction while `loading`
 * so assignment cannot fire twice.
 */
export function CollectorAssignDialog({
  open,
  collectionCode,
  currentCollectorId = null,
  loading = false,
  error,
  onClose,
  onConfirm,
}: CollectorAssignDialogProps) {
  const [chosenId, setChosenId] = React.useState<string | null>(null);
  const [refreshKey, setRefreshKey] = React.useState(0);

  // Bumped on close so the next open starts from the stored collector and a
  // fresh directory fetch.
  const openKey = open ? `open|${refreshKey}` : "";

  const [payload, setPayload] = React.useState<{
    key: string;
    data: CollectorOption[] | null;
    error: string | null;
  } | null>(null);

  React.useEffect(() => {
    if (!openKey) return; // dialog closed - nothing to fetch
    let cancelled = false;

    apiGet<ListResponse<CollectorOption>>("/api/home-collections/collectors")
      .then((result) => {
        if (cancelled) return;
        setPayload({ key: openKey, data: result.data, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setPayload({
          key: openKey,
          data: [],
          error:
            err instanceof ApiRequestError
              ? err.message
              : "Unable to load collectors.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [openKey]);

  const fresh = payload !== null && payload.key === openKey;
  const fetching = openKey !== "" && !fresh;
  const options = fresh ? (payload.data ?? []) : [];
  const fetchError = fresh ? payload.error : null;

  const collectorId = chosenId ?? currentCollectorId ?? "";

  function handleClose() {
    if (loading) return;
    setChosenId(null);
    setRefreshKey((value) => value + 1);
    onClose();
  }

  const selectOptions = options.map((option) => ({
    value: option.id,
    label: option.phone ? `${option.name} · ${option.phone}` : option.name,
  }));

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Assign a collector"
      description={`Choose the collector responsible for pickup ${collectionCode}. Reassignment replaces the current collector and is recorded in the audit history.`}
      size="sm"
      dismissible={!loading}
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Close
          </Button>
          <Button
            loading={loading || fetching}
            disabled={!collectorId || fetching}
            onClick={() => {
              setChosenId(null);
              setRefreshKey((value) => value + 1);
              onConfirm(collectorId);
            }}
          >
            Assign collector
          </Button>
        </>
      }
    >
      {fetchError ? (
        <p
          role="alert"
          className="mb-3 rounded-control border border-danger-line bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
        >
          {fetchError}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="mb-3 rounded-control border border-danger-line bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
        >
          {error}
        </p>
      ) : null}
      <Select
        aria-label="Collector"
        label="Collector"
        value={collectorId}
        onChange={(event) => setChosenId(event.target.value)}
        options={[
          {
            value: "",
            label: fetching
              ? "Loading collectors..."
              : "Select a collector",
          },
          ...selectOptions,
        ]}
        hint="Only active collector accounts can be assigned."
      />
    </Modal>
  );
}
