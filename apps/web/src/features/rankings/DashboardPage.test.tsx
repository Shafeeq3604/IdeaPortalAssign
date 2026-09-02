import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { DashboardResponse, DashboardTile, ListRankingsResponse } from "@iep/contracts";
import { renderWithProviders } from "../../test/render";
import { DashboardPage } from "./DashboardPage";

/**
 * Characterization tests for the management dashboard (P7 — FR-26, SPEC §9.9). The one
 * rule this screen exists to keep is "every tile leads to the list it counted" — the href
 * comes from the API, not something assembled here — so most of these tests check that a
 * tile's rendered link is exactly the API's own `href`, not a client-built guess.
 */

function tile(overrides: Partial<DashboardTile> = {}): DashboardTile {
  return { key: "total", label: "Total ideas", count: 8, href: "/ideas", ...overrides };
}

function dashboard(tiles: DashboardTile[]): DashboardResponse {
  return { tiles, generatedAt: "2026-08-01T00:00:00.000Z" };
}

const NINE_TILES: DashboardTile[] = [
  tile({ key: "total", label: "8 total ideas", count: 8, href: "/ideas" }),
  tile({ key: "new", label: "2 new this week", count: 2, href: "/ideas?status=SUBMITTED" }),
  tile({ key: "under_evaluation", label: "1 being evaluated", count: 1, href: "/ideas?status=AI_ANALYSIS" }),
  tile({ key: "requiring_review", label: "3 need a reviewer", count: 3, href: "/review" }),
  tile({ key: "top_ranked", label: "4 ranked", count: 4, href: "/rankings" }),
  tile({ key: "prototype", label: "0 in prototype", count: 0, href: "/ideas?status=PROTOTYPE_CANDIDATE" }),
  tile({ key: "pilot", label: "0 in pilot", count: 0, href: "/ideas?status=PILOT" }),
  tile({ key: "implemented", label: "0 implemented", count: 0, href: "/ideas?status=IMPLEMENTED" }),
  tile({ key: "parked", label: "0 parked", count: 0, href: "/ideas?status=PARKED" }),
];

function boardResponse(): ListRankingsResponse {
  return {
    items: [],
    meta: { page: 1, perPage: 25, total: 0, totalPages: 0 },
    run: { runId: "run-1", profileKey: "default", profileName: "Default", engineVersion: "1.0.0", cohortSize: 0, computedAt: "2026-08-01T00:00:00.000Z", triggerReason: "scheduled" },
  };
}

function stubFetch(overrides: { dashboardStatus?: number; recomputeStatus?: number } = {}) {
  const recompute = vi.fn();
  const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/dashboard") {
      if (overrides.dashboardStatus && overrides.dashboardStatus >= 400) {
        return Promise.resolve(new Response(JSON.stringify({}), { status: overrides.dashboardStatus }));
      }
      return Promise.resolve(new Response(JSON.stringify(dashboard(NINE_TILES)), { status: 200 }));
    }
    if (url.pathname === "/api/rankings") {
      return Promise.resolve(new Response(JSON.stringify(boardResponse()), { status: 200 }));
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
        new Response(JSON.stringify({ user: { id: "user-1", displayName: "Mo Manager", email: "mo@example.invalid", roles: ["MANAGEMENT"], department: null } }), { status: 200 }),
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

describe("DashboardPage", () => {
  it("links every pipeline tile to the API's own href, not a client-assembled one", async () => {
    stubFetch();

    renderWithProviders(<DashboardPage />, { route: "/dashboard" });

    expect(await screen.findByRole("link", { name: /8 total ideas/ })).toHaveAttribute("href", "/ideas");
    expect(screen.getByRole("link", { name: /3 need a reviewer/ })).toHaveAttribute("href", "/review");
    expect(screen.getByRole("link", { name: /4 ranked/ })).toHaveAttribute("href", "/rankings");
  });

  it("still renders a zero-count outcome tile as a link, rather than dropping it", async () => {
    stubFetch();

    renderWithProviders(<DashboardPage />, { route: "/dashboard" });

    const prototypeLink = await screen.findByRole("link", { name: /0 in prototype/ });
    expect(prototypeLink).toHaveAttribute("href", "/ideas?status=PROTOTYPE_CANDIDATE");
  });

  it("shows an error state with a retry action when the dashboard summary fails to load", async () => {
    stubFetch({ dashboardStatus: 500 });

    renderWithProviders(<DashboardPage />, { route: "/dashboard" });

    expect(await screen.findByRole("heading", { name: "Could not load the dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to ideas" })).toHaveAttribute("href", "/ideas");
  });

  it("refuses to recompute without a reason, and does not call the API", async () => {
    const { recompute } = stubFetch();

    renderWithProviders(<DashboardPage />, { route: "/dashboard" });
    await screen.findByRole("button", { name: "Recompute" });

    fireEvent.click(screen.getByRole("button", { name: "Recompute" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Say why/);
    expect(recompute).not.toHaveBeenCalled();
  });

  it("recomputes with the typed reason and reports the new cohort size", async () => {
    const { recompute } = stubFetch();

    renderWithProviders(<DashboardPage />, { route: "/dashboard" });
    await screen.findByRole("button", { name: "Recompute" });

    fireEvent.change(screen.getByLabelText("Why (required)"), { target: { value: "quarterly review board" } });
    fireEvent.click(screen.getByRole("button", { name: "Recompute" }));

    await waitFor(() => expect(recompute).toHaveBeenCalledWith(JSON.stringify({ profileKey: "default", reason: "quarterly review board" })));
    expect(await screen.findByRole("status")).toHaveTextContent("Done — 8 ideas ranked.");
  });

  it("reports a failed recompute without pretending the board changed", async () => {
    stubFetch({ recomputeStatus: 422 });

    renderWithProviders(<DashboardPage />, { route: "/dashboard" });
    await screen.findByRole("button", { name: "Recompute" });

    fireEvent.change(screen.getByLabelText("Why (required)"), { target: { value: "quarterly review board" } });
    fireEvent.click(screen.getByRole("button", { name: "Recompute" }));

    expect(await screen.findByText("The recompute did not run. The current board is unchanged.")).toBeInTheDocument();
  });
});
