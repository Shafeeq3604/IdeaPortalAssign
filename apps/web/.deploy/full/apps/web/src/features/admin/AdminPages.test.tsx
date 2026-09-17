import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../test/render";
import { AuditPage } from "./AdminPages";

/**
 * Characterization tests for Administration → Audit log, including the recompute control
 * moved here from the Dashboard (production UX review — a control that CREATES a new
 * ranking run is an administrative action, not a dashboard reading). These three cases
 * used to live in `DashboardPage.test.tsx`; the behavior is unchanged, only its home is.
 */

function auditResponse() {
  return {
    items: [],
    meta: { page: 1, perPage: 25, total: 0, totalPages: 0 },
  };
}

function stubFetch(overrides: { recomputeStatus?: number } = {}) {
  const recompute = vi.fn();
  const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/admin/audit") {
      return Promise.resolve(new Response(JSON.stringify(auditResponse()), { status: 200 }));
    }
    if (url.pathname === "/api/config/profiles") {
      return Promise.resolve(
        new Response(JSON.stringify({ items: [{ key: "default", name: "Default", description: "", isDefault: true, isActive: true, weights: [] }] }), { status: 200 }),
      );
    }
    if (url.pathname === "/api/rankings/recompute") {
      recompute(init?.body);
      if (overrides.recomputeStatus && overrides.recomputeStatus >= 400) {
        return Promise.resolve(new Response(JSON.stringify({ code: "VALIDATION_FAILED", message: "no", requestId: "r1" }), { status: overrides.recomputeStatus }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ runId: "run-2", profileKey: "default", profileName: "Default", engineVersion: "1.0.0", cohortSize: 8, computedAt: "2026-08-01T00:00:00.000Z", triggerReason: "manual" }), { status: 200 }),
      );
    }
    if (url.pathname === "/api/auth/session") {
      return Promise.resolve(
        new Response(JSON.stringify({ user: { id: "user-1", displayName: "Ash Admin", email: "admin@example.invalid", roles: ["ADMIN"], department: null } }), { status: 200 }),
      );
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, recompute };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The panel is a collapsed accordion by default (production UX review — it should not
 *  stand open at full height next to a log people check daily); every test opens it first. */
async function openRecomputePanel() {
  fireEvent.click(await screen.findByRole("button", { name: /Recompute the rankings/ }));
  await screen.findByLabelText("Why (required)");
}

describe("AuditPage — Recompute the rankings", () => {
  it("refuses to recompute without a reason, and does not call the API", async () => {
    const { recompute } = stubFetch();

    renderWithProviders(<AuditPage />, { route: "/admin/audit" });
    await openRecomputePanel();

    fireEvent.click(screen.getByRole("button", { name: "Recompute" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Say why/);
    expect(recompute).not.toHaveBeenCalled();
  });

  it("recomputes with the typed reason and reports the new cohort size", async () => {
    const { recompute } = stubFetch();

    renderWithProviders(<AuditPage />, { route: "/admin/audit" });
    await openRecomputePanel();

    fireEvent.change(screen.getByLabelText("Why (required)"), { target: { value: "quarterly review board" } });
    fireEvent.click(screen.getByRole("button", { name: "Recompute" }));

    await waitFor(() => expect(recompute).toHaveBeenCalledWith(JSON.stringify({ profileKey: "default", reason: "quarterly review board" })));
    expect(await screen.findByRole("status")).toHaveTextContent("Done — 8 ideas ranked.");
  });

  it("reports a failed recompute without pretending the board changed", async () => {
    stubFetch({ recomputeStatus: 422 });

    renderWithProviders(<AuditPage />, { route: "/admin/audit" });
    await openRecomputePanel();

    fireEvent.change(screen.getByLabelText("Why (required)"), { target: { value: "quarterly review board" } });
    fireEvent.click(screen.getByRole("button", { name: "Recompute" }));

    expect(await screen.findByText("The recompute did not run. The current board is unchanged.")).toBeInTheDocument();
  });
});
