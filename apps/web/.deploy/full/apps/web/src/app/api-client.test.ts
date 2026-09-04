import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, ApiUnreachableError, api } from "./api-client";

/**
 * Characterization tests for `api()` — "the only way the app talks to the API," per its
 * own file comment, and previously untested despite that claim. It has several branches
 * that only fire on network trouble (a down proxy, a gateway timeout, a non-JSON body),
 * which is exactly the code path most likely to be exercised for the first time during a
 * real incident rather than in development. These tests pin its CURRENT behavior branch
 * by branch, using real `Response` objects (Node's global, not a hand-rolled fake) so the
 * tests exercise the same `.headers.get()` / `.text()` surface the real code does.
 */

const fetchMock = vi.fn();

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

function stubFetch(response: Response | (() => Promise<never>)) {
  vi.stubGlobal(
    "fetch",
    fetchMock.mockImplementation(() =>
      typeof response === "function" ? response() : Promise.resolve(response),
    ),
  );
}

describe("api()", () => {
  it("requests the /api-prefixed path with credentials included", async () => {
    stubFetch(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await api("/ideas");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ideas",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("returns the parsed JSON body on a 200", async () => {
    stubFetch(new Response(JSON.stringify({ id: "idea-1" }), { status: 200 }));
    await expect(api("/ideas/idea-1")).resolves.toEqual({ id: "idea-1" });
  });

  it("returns undefined on a 204, without attempting to parse a body", async () => {
    stubFetch(new Response(null, { status: 204 }));
    await expect(api("/ideas/idea-1")).resolves.toBeUndefined();
  });

  it("sets a JSON content-type when the body is a plain object", async () => {
    stubFetch(new Response("{}", { status: 200 }));
    await api("/ideas", { method: "POST", body: JSON.stringify({ title: "x" }) });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("does NOT set a content-type when the body is FormData, leaving the multipart boundary to the browser", async () => {
    stubFetch(new Response("{}", { status: 200 }));
    await api("/ideas/idea-1/attachments", { method: "POST", body: new FormData() });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["content-type"]).toBeUndefined();
  });

  it("lets an explicit header override the computed content-type", async () => {
    stubFetch(new Response("{}", { status: 200 }));
    await api("/ideas", {
      method: "POST",
      body: JSON.stringify({}),
      headers: { "content-type": "application/custom" },
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/custom");
  });

  it("throws ApiUnreachableError when fetch itself rejects (a transport failure)", async () => {
    stubFetch(() => Promise.reject(new TypeError("network error")));
    const error = await api("/ideas").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiUnreachableError);
    expect((error as ApiUnreachableError).path).toBe("/ideas");
  });

  it("throws ApiError with the parsed body on a non-OK JSON response", async () => {
    const body = { code: "VALIDATION_FAILED", message: "Bad input", requestId: "req-1" };
    stubFetch(new Response(JSON.stringify(body), { status: 400 }));
    const error = await api("/ideas").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).body).toEqual(body);
    expect((error as ApiError).message).toBe("Bad input");
  });

  it("falls back to a synthesized error body when a non-OK response has no body at all", async () => {
    stubFetch(new Response(null, { status: 500, statusText: "Internal Server Error" }));
    const error = (await api("/ideas").catch((e: unknown) => e)) as ApiError;
    expect(error.body).toEqual({
      code: "INTERNAL_ERROR",
      message: "Internal Server Error",
      requestId: "unknown",
    });
  });

  it("treats a non-JSON body from an endpoint as ApiUnreachableError, not a parse error", async () => {
    stubFetch(new Response("<html>bad gateway</html>", { status: 200 }));
    const error = await api("/ideas").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiUnreachableError);
  });

  it("treats a 502/503/504 with a non-JSON body as ApiUnreachableError (a proxy answered, not the API)", async () => {
    stubFetch(new Response("Bad Gateway", { status: 502, statusText: "Bad Gateway" }));
    const error = await api("/ideas").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiUnreachableError);
  });

  it("treats a 502 that DOES carry a JSON body as a real ApiError, not unreachable", async () => {
    const body = { code: "INTERNAL_ERROR", message: "Upstream failed", requestId: "req-2" };
    stubFetch(
      new Response(JSON.stringify(body), {
        status: 502,
        headers: { "content-type": "application/json" },
      }),
    );
    const error = await api("/ideas").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).body).toEqual(body);
  });
});

describe("ApiError.isClientError", () => {
  it("is true for 4xx", () => {
    expect(new ApiError(400, { code: "VALIDATION_FAILED", message: "x", requestId: "r" }).isClientError).toBe(true);
    expect(new ApiError(404, { code: "NOT_FOUND", message: "x", requestId: "r" }).isClientError).toBe(true);
    expect(new ApiError(499, { code: "NOT_FOUND", message: "x", requestId: "r" }).isClientError).toBe(true);
  });

  it("is false for 5xx and for anything below 400", () => {
    expect(new ApiError(500, { code: "INTERNAL_ERROR", message: "x", requestId: "r" }).isClientError).toBe(false);
    expect(new ApiError(200, { code: "INTERNAL_ERROR", message: "x", requestId: "r" }).isClientError).toBe(false);
  });
});
