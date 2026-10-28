"use client";

import * as React from "react";

import { apiGet, ApiRequestError } from "@/lib/api/client";
import type { ListMeta, ListResponse } from "@/types/api";

const DEFAULT_META: ListMeta = {
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 1,
  hasPrev: false,
  hasNext: false,
};

export interface ApiListResult<T> {
  data: T[] | null;
  meta: ListMeta;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches a paginated list endpoint keyed by `url`.
 *
 * `loading` is derived from whether the cached payload matches the current
 * request key, so no state update runs synchronously inside the effect body -
 * every write happens in a promise callback. `refresh()` bumps the key from an
 * event handler to re-issue the request.
 */
export function useApiList<T>(url: string): {
  state: ApiListResult<T>;
  refresh: () => void;
} {
  const [refreshKey, setRefreshKey] = React.useState(0);
  const requestKey = `${url}|${refreshKey}`;

  const [payload, setPayload] = React.useState<{
    requestKey: string;
    data: T[] | null;
    meta: ListMeta;
    error: string | null;
  } | null>(null);

  React.useEffect(() => {
    if (!url) return; // nothing selected yet - skip the request entirely
    let cancelled = false;

    apiGet<ListResponse<T>>(url)
      .then((result) => {
        if (cancelled) return;
        setPayload({
          requestKey,
          data: result.data,
          meta: result.meta,
          error: null,
        });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPayload({
          requestKey,
          data: null,
          meta: DEFAULT_META,
          error:
            error instanceof ApiRequestError
              ? error.message
              : "Unable to load data right now.",
        });
      });

    return () => {
      cancelled = true;
    };
  }, [url, requestKey]);

  // An empty `url` means "nothing to show yet": not loading, no data, no error.
  const active = Boolean(url) && payload !== null && payload.requestKey === requestKey;
  const loading = Boolean(url) && (payload === null || payload.requestKey !== requestKey);

  const refresh = React.useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  return {
    state: {
      data: active ? payload?.data ?? null : null,
      meta: active ? payload?.meta ?? DEFAULT_META : DEFAULT_META,
      loading,
      error: active ? payload?.error ?? null : null,
    },
    refresh,
  };
}

/**
 * Search input with a built-in debounce.
 *
 * The applied value and any page reset happen inside the timeout callback
 * (never synchronously in the effect body), which keeps the React compiler
 * lint rule happy while preserving the usual type-then-wait UX.
 */
export function useDebouncedSearch(initial = ""): {
  search: string;
  setSearch: (value: string) => void;
  applied: string;
} {
  const [search, setSearch] = React.useState(initial);
  const [applied, setApplied] = React.useState(initial);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setApplied(search);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  return {
    search,
    setSearch,
    applied,
  };
}
