import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { ListRankingsResponse, RankingEntry } from "@iep/contracts";
import { renderWithProviders } from "../../test/render";
import { RankingsPage } from "./RankingsPage";

/**
 * Characterization tests for the ranked board (P7 — FR-26, SPEC §9.9). Only `fetch` is
 * stubbed; profile/rank-band selection and Compare go through real `useSearchParams`
 * state via MemoryRouter, matching how a person actually drives this screen (§7.8).
 */

function row(overrides: Partial<RankingEntry> = {}): RankingEntry {
  return {
    rank: 1,
    previousRank: null,
    ideaId: "idea-1",
    title: "A faster way to file expenses",
    compositeScore: 88.4,
    percentile: 95,
    maturityLevel: 3,
    feasibilityStatus: null,
    department: "Finance",
    submitter: { id: "user-1", displayName: "Priya Patel", departmentName: "Finance" },
    topStrength: {
      criterionKey: "impact", criterionLabel: "Business impact", contribution: 15.8,
      shareOfTotal: 0.18, text: "Business impact scored 88 of 100.", normalized: 88, headroom: 12,
      evidence: [],
    },
    topConstraint: null,
    ...overrides,
  };
}

function board(items: RankingEntry[], overrides: Partial<ListRankingsResponse["run"]> = {}): ListRankingsResponse {
  return {
    items,
    meta: { page: 1, perPage: 25, total: items.length, totalPages: 1 },
    run: {
      runId: "run-1", profileKey: "default", profileName: "Default", engineVersion: "1.0.0",
      cohortSize: items.length, computedAt: "2026-08-01T00:00:00.000Z", triggerReason: "scheduled",
      ...overrides,
    },
  };
}

function stubFetch(handlers: { rankings?: (url: URL) => unknown; profiles?: unknown }) {
  const fetchMock = vi.fn((input: string | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/config/profiles") {
      return Promise.resolve(
        new Response(JSON.stringify(handlers.profiles ?? { items: [{ key: "default", name: "Default", description: "", isDefault: true, isActive: true, weights: [] }] }), { status: 200 }),
      );
    }
    if (url.pathname === "/api/rankings" && handlers.rankings) {
      return Promise.resolve(new Response(JSON.stringify(handlers.rankings(url)), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RankingsPage", () => {
  it("puts the top three on a podium and everything else in the list below it, by rank not array position", async () => {
    stubFetch({
      rankings: () =>
        board([
          row({ rank: 1, ideaId: "idea-1", title: "First place" }),
          row({ rank: 4, ideaId: "idea-4", title: "Fourth place", compositeScore: 61.2, topStrength: null }),
        ]),
    });

    renderWithProviders(<RankingsPage />, { route: "/rankings" });

    await screen.findByRole("heading", { name: "First place", level: 2 });
    // The podium crowns rank 1 specifically — a filtered page with no rank-1 row must not
    // promote whatever happens to be first in the array (the bug this shape invites).
    expect(screen.getByText("88.4")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Fourth place", level: 2 })).toBeInTheDocument();
  });

  it("shows the cohort-empty message, not the filtered-empty one, when nothing has been evaluated yet", async () => {
    stubFetch({ rankings: () => board([], { cohortSize: 0 }) });

    renderWithProviders(<RankingsPage />, { route: "/rankings" });

    expect(await screen.findByRole("heading", { name: "No ranked ideas here" })).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been evaluated under this profile yet/)).toBeInTheDocument();
  });

  it("shows the filtered-empty message, not the cohort-empty one, when the cohort just excludes these filters", async () => {
    stubFetch({ rankings: () => board([], { cohortSize: 12 }) });

    renderWithProviders(<RankingsPage />, { route: "/rankings" });

    expect(await screen.findByRole("heading", { name: "No ranked ideas here" })).toBeInTheDocument();
    expect(screen.getByText(/No idea matches these filters/)).toBeInTheDocument();
  });

  it("writes the rank-band choice to the URL and refetches under it", async () => {
    const fetchMock = stubFetch({ rankings: () => board([row()]) });

    renderWithProviders(<RankingsPage />, { route: "/rankings" });
    await screen.findByRole("heading", { name: "A faster way to file expenses", level: 2 });

    fireEvent.click(screen.getByRole("button", { name: "Top 10" }));

    await waitFor(() => {
      const calls = fetchMock.mock.calls
        .map((c) => new URL(String(c[0]), "http://localhost"))
        .filter((u) => u.pathname === "/api/rankings");
      expect(calls.at(-1)?.searchParams.get("rankBand")).toBe("top10");
    });
  });

  it("only offers to compare once two ideas are selected", async () => {
    stubFetch({ rankings: () => board([row({ rank: 1, ideaId: "idea-1", title: "First place" }), row({ rank: 2, ideaId: "idea-2", title: "Second place" })]) });

    renderWithProviders(<RankingsPage />, { route: "/rankings" });
    await screen.findByRole("heading", { name: "First place", level: 2 });

    expect(screen.queryByText(/Compare \d+ selected ideas/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select First place for comparison" }));
    expect(screen.getByText("Select one more to compare.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Second place for comparison" }));
    const compareLink = screen.getByRole("link", { name: "Compare 2 selected ideas" });
    expect(compareLink).toHaveAttribute("href", expect.stringContaining("ids=idea-1"));
    expect(compareLink).toHaveAttribute("href", expect.stringContaining("ids=idea-2"));
  });

  it("shows an error state with a retry action when the board fails to load", async () => {
    const fetchMock = vi.fn((input: string | URL) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/config/profiles") {
        return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 500 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<RankingsPage />, { route: "/rankings" });

    expect(await screen.findByRole("heading", { name: "Could not load the rankings" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to ideas" })).toHaveAttribute("href", "/ideas");
  });
});
