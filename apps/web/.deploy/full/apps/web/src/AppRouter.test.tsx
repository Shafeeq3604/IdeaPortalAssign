import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppRouter } from "./AppRouter.js";

/**
 * Characterization tests for the router's catch-all — `Unreachable` in AppRouter.tsx,
 * the highest-churn file in apps/web (13 commits) and the one this session's audit found
 * printing raw enum values ("EMPLOYEE, MANAGEMENT") instead of "Employee, Management" on
 * the exact screen a role mismatch lands a real user on. `Unreachable` is not exported —
 * this drives it the way a user actually reaches it: a real session response, a real
 * route, through the real router.
 *
 * Only `fetch` is faked (jsdom has no server to talk to); everything downstream —
 * routing, the session hook, the role gate, the component tree — is the real thing.
 */

const SESSION_BODY = {
  user: {
    id: "user-1",
    displayName: "Erin Employee",
    email: "employee@example.invalid",
    roles: ["EMPLOYEE"],
    department: null,
  },
};

function mockSessionFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (String(url).includes("/auth/session")) {
        return Promise.resolve(new Response(JSON.stringify(SESSION_BODY), { status: 200 }));
      }
      // Anything else (there should be nothing else on this screen) fails loudly rather
      // than hanging the test on an unresolved promise.
      return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the catch-all route", () => {
  it("shows a humanised role mismatch, not the raw enum values, for a restricted route", async () => {
    mockSessionFetch();
    window.history.pushState({}, "", "/admin/users");

    render(<AppRouter />);

    expect(await screen.findByRole("heading", { name: "Not available for your role" })).toBeInTheDocument();
    // The nav map's own title for /admin/users (SPEC — titles are read from the map,
    // never re-typed at the call site).
    expect(screen.getByText(/Users & roles is restricted to Admin\./)).toBeInTheDocument();
    expect(screen.getByText(/You\s+have Employee\./)).toBeInTheDocument();

    // The bug this test guards: raw enum values must not appear anywhere on the page.
    expect(screen.queryByText(/\bADMIN\b/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bEMPLOYEE\b/)).not.toBeInTheDocument();

    expect(screen.getByRole("link", { name: "Back to ideas" })).toBeInTheDocument();
  });

  it("shows a plain 'not found' for a URL matching no route at all, with no role talk", async () => {
    mockSessionFetch();
    window.history.pushState({}, "", "/this-page-does-not-exist");

    render(<AppRouter />);

    expect(await screen.findByRole("heading", { name: "Not found" })).toBeInTheDocument();
    expect(screen.getByText("No page matches this address.")).toBeInTheDocument();
    expect(screen.queryByText(/restricted to/)).not.toBeInTheDocument();
  });
});
