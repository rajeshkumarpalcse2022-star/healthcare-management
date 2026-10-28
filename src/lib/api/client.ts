import type { ApiFieldIssue } from "@/types/api";

/**
 * Browser-side fetch helper for the management APIs.
 *
 * Turns non-2xx responses into a typed `ApiRequestError` carrying the server's
 * safe error message and field issues. Never throws raw driver/network noise
 * to the UI - the caller decides how to present the message.
 */

export class ApiRequestError extends Error {
  readonly status: number;
  readonly issues?: ApiFieldIssue[];

  constructor(message: string, status: number, issues?: ApiFieldIssue[]) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.issues = issues;
  }
}

interface ErrorPayload {
  error?: string;
  issues?: ApiFieldIssue[];
}

/** Performs a JSON request and returns the parsed success payload. */
export async function apiRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const isFormData =
    typeof FormData !== "undefined" && init?.body instanceof FormData;

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      cache: "no-store",
      headers: {
        ...(init?.body && !isFormData
          ? { "Content-Type": "application/json" }
          : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new ApiRequestError(
      "Unable to reach the server. Check your connection and try again.",
      0,
    );
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const body = payload as ErrorPayload | null;
    throw new ApiRequestError(
      body?.error ?? "The request could not be completed. Please try again.",
      response.status,
      body?.issues,
    );
  }

  return payload as T;
}

/** Convenience wrapper for GET requests. */
export function apiGet<T>(url: string): Promise<T> {
  return apiRequest<T>(url, { method: "GET" });
}

/** Convenience wrapper for JSON POST/PUT/PATCH requests. */
export function apiSend<T>(
  url: string,
  method: "POST" | "PUT" | "PATCH",
  body: unknown,
): Promise<T> {
  return apiRequest<T>(url, {
    method,
    body: JSON.stringify(body),
  });
}

/** Convenience wrapper for multipart uploads (browser sets the boundary). */
export function apiUpload<T>(url: string, formData: FormData): Promise<T> {
  return apiRequest<T>(url, {
    method: "POST",
    body: formData,
  });
}

/** Convenience wrapper for DELETE requests. */
export function apiDelete<T>(url: string): Promise<T> {
  return apiRequest<T>(url, { method: "DELETE" });
}
