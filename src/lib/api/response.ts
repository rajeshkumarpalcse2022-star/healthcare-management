import { NextResponse } from "next/server";

import { LIST_DEFAULT_LIMIT } from "@/config/doctors";
import type {
  ApiErrorBody,
  ApiFieldIssue,
  ItemResponse,
  ListMeta,
  ListResponse,
} from "@/types/api";

/** Shared no-store policy for every management response. */
export const NO_STORE = { "Cache-Control": "no-store" } as const;

/** Success envelope for a single record. */
export function itemResponse<T>(data: T, status = 200): NextResponse {
  return NextResponse.json<ItemResponse<T>>(
    { success: true, data },
    { status, headers: NO_STORE },
  );
}

/** Success envelope for a paginated list. */
export function listResponse<T>(
  data: T[],
  meta: ListMeta,
): NextResponse {
  return NextResponse.json<ListResponse<T>>(
    { success: true, data, meta },
    { status: 200, headers: NO_STORE },
  );
}

/**
 * Error envelope used by every management endpoint.
 *
 * Messages are safe for clients: no stack traces, no connection strings, no
 * internal database errors.
 */
export function errorResponse(
  status: number,
  error: string,
  issues?: ApiFieldIssue[],
): NextResponse {
  return NextResponse.json<ApiErrorBody>(
    { success: false, error, ...(issues && issues.length > 0 ? { issues } : {}) },
    { status, headers: NO_STORE },
  );
}

/** Builds the pagination envelope from a page/limit/total triple. */
export function buildListMeta(
  page: number,
  limit: number,
  total: number,
): ListMeta {
  const safeLimit = limit > 0 ? limit : LIST_DEFAULT_LIMIT;
  const totalPages = Math.max(1, Math.ceil(total / safeLimit));
  return {
    page,
    limit: safeLimit,
    total,
    totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
}

/**
 * Detects MongoDB duplicate-key failures (E11000) without surfacing driver
 * internals to the client.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}

/** Logs a server-side failure; the client always receives a generic message. */
export function logApiFailure(
  scope: string,
  error: unknown,
): void {
  console.error(
    `[api/${scope}] failed:`,
    error instanceof Error ? error.message : "unknown error",
  );
}
