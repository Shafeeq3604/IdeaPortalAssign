import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import type { IdeaSummary, ListIdeasResponse } from "@iep/contracts";
import { renderWithProviders } from "../../test/render";
import { IdeaListPage } from "./IdeaListPage";

/**
 * Characterization tests for the idea list (SPEC §6.2 rows 2, 25) — the highest-traffic
 * read screen in the app. Only `fetch` is stubbed; the URL-is-the-source-of-truth filter
 * behaviour (§7.8, §6.3 assertion 4) is exercised through real `useSearchParams` state via
 * MemoryRouter, not asserted against internal component state.
 */

function idea(overrides: Partial<IdeaSummary> = {}): IdeaSummary {
  return {
    id: "idea-1",
    title: "A faster way to file expenses",
    status: "RANKED",
    maturityLevel: 3,
    submitter: { id: "user-1", displayName: "Priya Patel", departmentName: "Finance" },
    department: { id: "dept-1", name: "Finance" },
    category: null,
    currentVersionNo: 1,
    submittedAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    rank: 3,
    compositeScore: 82.4,
    ...overrides,
  };
}

function listResponse(items: IdeaSummary[], overrides: Partial<ListIdeasResponse["meta"]> = {}): ListIdeasResponse {
  return { items, meta: { page: 1, perPage: 25, total: items.length, totalPages: 1, ...overrides } };
}

function stubFetch(handlers: { list?: (url: URL) => unknown; session?: unknown }) {
  const fetchMock = vi.fn((input: string | URL) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/auth/session") {
      return Promise.resolve(
        new Response(
          JSON.stringify(
            handlers.session ?? {
              user: { id: "user-1", displayName: "Priya Patel", email: "priya@example.invalid", roles: ["EMPLOYEE"], department: null },
            },
          ),
          { status: 200 },
        ),
      );
    }
    if (url.pathname === "/api/ideas" && handlers.list) {
      return Promise.resolve(new Response(JSON.stringify(handlers.list(url)), { status: 200 }));
    }
    // Every card also queries vote counts; answering with an empty summary keeps that
    // query harmless instead of leaving it pending or throwing.
    if (url.pathname.endsWith("/feedback")) {
      return Promise.resolve(new Response(JSON.stringify({ up: 0, down: 0, myVote: null }), { status: 200 }));
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("IdeaListPage", () => {
  it("renders each idea as a whole-card link, with its rank and score", async () => {
    stubFetch({ list: () => listResponse([idea()]) });

    renderWithProviders(<IdeaListPage scope="all" />, { route: "/ideas" });

    const link = await screen.findByRole("link", { name: "A faster way to file expenses" });
    expect(link).toHaveAttribute("href", "/ideas/idea-1/overview");
    expect(screen.getByText("Ranked #3")).toBeInTheDocument();
    expect(screen.getByText("82.4")).toBeInTheDocument();
    expect(screen.getByText(/Priya Patel/)).toBeInTheDocument();
  });

  it("shows the scope-specific empty state, not a generic one, when there is nothing to list", async () => {
    stubFetch({ list: () => listResponse([]) });

    renderWithProviders(<IdeaListPage scope="mine" />, { route: "/me/ideas" });

    expect(await screen.findByRole("heading", { name: "You have not submitted anything yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Submit the first one" })).toHaveAttribute("href", "/ideas/new");
  });

  it("shows an error state with a retry action when the list fails to load", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 500 })));
    vi.stubGlobal("fetch", fetchMock);

    renderWithProviders(<IdeaListPage scope="all" />, { route: "/ideas" });

    expect(await screen.findByRole("heading", { name: "Could not load ideas" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Submit an idea instead" })).toHaveAttribute("href", "/ideas/new");
  });

  it("writes a status filter to the URL and refetches with it, resetting off whatever page it was on", async () => {
    const fetchMock = stubFetch({ list: () => listResponse([idea()]) });

    // Page 2 up front, so a reset back to page 1 is an observable change rather than
    // page 1 simply never having moved.
    renderWithProviders(<IdeaListPage scope="all" />, { route: "/ideas?page=2" });
    await screen.findByRole("link", { name: "A faster way to file expenses" });

    const listCalls = () =>
      fetchMock.mock.calls
        .map((c) => new URL(String(c[0]), "http://localhost"))
        .filter((u) => u.pathname === "/api/ideas");
    expect(listCalls().at(-1)?.searchParams.get("page")).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "Ranked" }));

    await waitFor(() => {
      expect(listCalls().some((u) => u.searchParams.getAll("status").includes("RANKED"))).toBe(true);
    });
    expect(listCalls().at(-1)?.searchParams.get("page")).toBe("1");
  });

  it("does not treat a job still analysing as a zero score", async () => {
    stubFetch({ list: () => listResponse([idea({ id: "idea-2", status: "AI_ANALYSIS", rank: null, compositeScore: null })]) });

    renderWithProviders(<IdeaListPage scope="all" />, { route: "/ideas" });

    await screen.findByRole("link", { name: "A faster way to file expenses" });
    expect(screen.getByText(/analysis/i)).toBeInTheDocument();
    expect(screen.getByText(/running/i)).toBeInTheDocument();
    expect(screen.queryByText("Ranked #")).not.toBeInTheDocument();
  });

  it("shows Previous/Next paging, not a page it does not have, on a single-page result", async () => {
    stubFetch({ list: () => listResponse([idea()]) });

    renderWithProviders(<IdeaListPage scope="all" />, { route: "/ideas" });

    await screen.findByRole("link", { name: "A faster way to file expenses" });
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    expect(screen.getByText("1 idea.")).toBeInTheDocument();
  });
});
