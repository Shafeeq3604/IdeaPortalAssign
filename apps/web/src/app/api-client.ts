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

/**
 * The API could not be reached at all — no response, so no status code.
 *
 * Distinct from ApiError on purpose: "the server said no" and "there is no server" need
 * different messages and different retry behaviour. Retrying a refused connection just
 * floods the log without ever succeeding.
 */
export class ApiUnreachableError extends Error {
  readonly path: string;

  constructor(path: string, cause: unknown) {
    super("Could not reach the API server");
    this.name = "ApiUnreachableError";
    this.path = path;
    this.cause = cause;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      // Session cookie must travel; the API sets CORS credentials to match.
      credentials: "include",
      headers: {
        /*
         * JSON unless the body is a FormData, in which case the browser MUST set the
         * header itself — only it knows the multipart boundary it generated. Setting
         * "application/json" over a file upload produces a body the server cannot parse
         * and an error that appears to blame the file.
         */
        ...(init.body && !(init.body instanceof FormData)
          ? { "content-type": "application/json" }
          : {}),
        ...init.headers,
      },
    });
  } catch (cause) {
    // fetch rejects only on a transport failure — the API is down, or the proxy cannot
    // connect. Never a 4xx/5xx, which resolve normally and are handled below.
    throw new ApiUnreachableError(path, cause);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();

  /**
   * A dev proxy (and most reverse proxies) answer 502/503/504 with a plain-text body when
   * the upstream is down — the fetch itself succeeds, so the transport catch above never
   * fires. Without this, "the API isn't running" is indistinguishable from a server bug.
   */
  const isGatewayFailure = response.status === 502 || response.status === 503 || response.status === 504;
  const looksLikeJson = (response.headers.get("content-type") ?? "").includes("json");
  if (isGatewayFailure && !looksLikeJson) {
    throw new ApiUnreachableError(path, `${response.status} ${response.statusText}`);
  }

  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (cause) {
    // A non-JSON body from an endpoint that always speaks JSON means we are not talking
    // to the API — something else answered.
    throw new ApiUnreachableError(path, cause);
  }

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
