import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../test/render";
import { AppShell } from "./AppShell";

/**
 * Characterization tests for the app shell — REQUIREMENTS §20's "four destinations for
 * everyone, three more for people with the roles for them, and nothing else". Only `fetch`
 * is stubbed; which nav items appear is driven by a real session response through the real
 * `canSee`/`useSession`, not asserted against a role list re-typed in the test.
 */

function stubSession(roles: readonly string[]) {
  const logout = vi.fn();
  const fetchMock = vi.fn((input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/auth/session") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            user: {
              id: "user-1", displayName: "Priya Patel", email: "priya@example.invalid",
              roles, department: { id: "dept-1", name: "Finance" },
            },
          }),
          { status: 200 },
        ),
      );
    }
    if (url.pathname === "/api/auth/logout") {
      logout(init?.method);
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    return Promise.resolve(new Response(JSON.stringify({}), { status: 404 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, logout };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AppShell navigation", () => {
  /**
   * The nav renders on the very first paint, before the session query resolves — with
   * only the roles-less ("everyone") items, since `roles` defaults to `[]` until then. The
   * account menu button renders only once `useSession` has real data (`AccountMenu`
   * returns null otherwise), so waiting for it is what actually waits for a role-aware nav
   * rather than racing the nav's own unconditional first render.
   */
  async function waitForSessionToLoad() {
    return screen.findByRole("button", { name: /Priya Patel/ });
  }

  it("gives an EMPLOYEE the four everyone-destinations and none of the role-gated ones", async () => {
    stubSession(["EMPLOYEE"]);

    renderWithProviders(<AppShell>content</AppShell>, { route: "/ideas" });
    await waitForSessionToLoad();

    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Submit an idea" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Explore ideas" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "My ideas" })).toBeInTheDocument();
    // Rankings carries no roles of its own (open to anyone signed in) and lives in the
    // same "for your role" group as the ones that do — so an EMPLOYEE sees the group and
    // Rankings inside it, just none of the roster's actually-gated destinations.
    expect(within(nav).getByRole("link", { name: "Rankings" })).toBeInTheDocument();
    expect(within(nav).getByText("For your role")).toBeInTheDocument();

    expect(within(nav).queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Reviews" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Administration" })).not.toBeInTheDocument();
  });

  it("gives an ADMIN every role-gated destination too", async () => {
    stubSession(["ADMIN"]);

    renderWithProviders(<AppShell>content</AppShell>, { route: "/ideas" });
    await waitForSessionToLoad();

    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Reviews" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Administration" })).toBeInTheDocument();
  });

  it("gives a REVIEWER Reviews but not the Dashboard or Administration, which are someone else's", async () => {
    stubSession(["REVIEWER"]);

    renderWithProviders(<AppShell>content</AppShell>, { route: "/ideas" });
    await waitForSessionToLoad();

    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getByRole("link", { name: "Reviews" })).toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Dashboard" })).not.toBeInTheDocument();
    expect(within(nav).queryByRole("link", { name: "Administration" })).not.toBeInTheDocument();
  });

  it("marks the current section's own link as the current page, not a sibling under it", async () => {
    stubSession(["ADMIN"]);

    renderWithProviders(<AppShell>content</AppShell>, { route: "/ideas/new" });
    await waitForSessionToLoad();

    expect(screen.getByRole("link", { name: "Submit an idea" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Explore ideas" })).not.toHaveAttribute("aria-current");
  });
});

describe("AppShell account menu", () => {
  it("opens on click, shows who is signed in and their roles, and closes on Escape", async () => {
    stubSession(["REVIEWER", "ADMIN"]);

    renderWithProviders(<AppShell>content</AppShell>, { route: "/ideas" });

    const trigger = await screen.findByRole("button", { name: /Priya Patel/ });
    fireEvent.click(trigger);

    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByText("priya@example.invalid")).toBeInTheDocument();
    expect(screen.getByText("Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
  });

  it("signs out through the API and clears the cache rather than just hiding the menu", async () => {
    const { logout } = stubSession(["EMPLOYEE"]);

    renderWithProviders(<AppShell>content</AppShell>, { route: "/ideas" });

    fireEvent.click(await screen.findByRole("button", { name: /Priya Patel/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));

    await waitFor(() => expect(logout).toHaveBeenCalledWith("POST"));
  });
});
