"use client";

import * as React from "react";

import { apiGet, ApiRequestError } from "@/lib/api/client";
import type { ListResponse } from "@/types/api";
import type { LabDepartment } from "@/types/lab-department";

export interface DepartmentOption {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
}

/**
 * Department options for one laboratory (form pickers and directory filters).
 *
 * Loading is derived from whether the cached payload matches the current
 * request key, so no state update runs synchronously in the effect body -
 * every write happens in a promise callback. An empty `laboratoryId` skips
 * the fetch entirely and yields an empty option list.
 */
export function useDepartmentOptions(laboratoryId: string): {
  options: DepartmentOption[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [refreshKey, setRefreshKey] = React.useState(0);
  const requestKey = `${laboratoryId}|${refreshKey}`;

  const [payload, setPayload] = React.useState<{
    requestKey: string;
    options: DepartmentOption[];
    error: string | null;
  } | null>(null);

  React.useEffect(() => {
    if (!laboratoryId) return;
    let cancelled = false;

    apiGet<ListResponse<LabDepartment>>(
      `/api/laboratories/${laboratoryId}/departments?status=all&limit=50`,
    )
      .then((result) => {
        if (cancelled) return;
        setPayload({
          requestKey,
          options: result.data.map((department) => ({
            id: department.id,
            name: department.name,
            code: department.code,
            isActive: department.isActive,
          })),
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPayload({
          requestKey,
          options: [],
          error:
            error instanceof ApiRequestError
              ? error.message
              : "Unable to load the department list.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [laboratoryId, requestKey]);

  const active = payload !== null && payload.requestKey === requestKey;

  const refresh = React.useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  return {
    options: laboratoryId && active ? payload.options : [],
    loading: Boolean(laboratoryId) && !active,
    error: laboratoryId && active ? payload.error : null,
    refresh,
  };
}
