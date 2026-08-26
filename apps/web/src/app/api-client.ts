import type { ErrorResponse } from "@iep/contracts";

/**
 * The only way the app talks to the API (SPEC §7.8).
 *
 * Everything goes through here so credentials, error shape and the base path are decided
 * once. A raw `fetch` in a feature is a drift smell (SKILL.md §3).
 */

const BASE = "/api";

export class ApiError extends Error {
  // Declared explicitly rather than as constructor parameter properties: the web app
  // sets `erasableSyntaxOnly`, so TypeScript-only syntax that emits code is banned.
  readonly status: number;
  readonly body: ErrorResponse;

  constructor(status: number, body: ErrorResponse) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
  /** Lets TanStack Query's retry rule skip deliberate refusals. */
  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    // Session cookie must travel; the API sets CORS credentials to match.
    credentials: "include",
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    const body = (parsed ?? {
      code: "INTERNAL_ERROR",
      message: response.statusText,
      requestId: "unknown",
    }) as ErrorResponse;
    throw new ApiError(response.status, body);
  }
  return parsed as T;
}
