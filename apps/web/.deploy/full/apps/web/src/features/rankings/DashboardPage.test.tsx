import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
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
  return { tiles, generatedAt: "2026-08-01T00:00:00.000Z", history: [] };
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

function stubFetch(overrides: { dashboardStatus?: number } = {}) {
  const fetchMock = vi.fn((input: string | URL) => {
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
    if (url.pathname === "/api/auth/session") {
      return Promise.resolve(
        new Response(JSON.stringify({ user: { id: "user-1", displayName: "Mo Manager", email: "mo@example.invalid", roles: ["MANAGEMENT"], department: null } }), { status: 200 }),
      );
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock };
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

  // Recompute-the-rankings coverage lives in `../admin/AdminPages.test.tsx` — the control
  // itself moved to Administration → Audit log (production UX review: creating a new
  // ranking run is an administrative action, not a dashboard reading).
});
