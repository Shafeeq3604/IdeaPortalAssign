import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ROUTES, matchRouteId, type Role } from "@iep/contracts";
import { Button } from "@iep/ui";
import { LoginPage } from "./features/auth/LoginPage";
import { IdeaListPage } from "./features/ideas/IdeaListPage";
import { SubmitIdeaPage } from "./features/ideas/SubmitIdeaPage";
import { ReviseIdeaPage } from "./features/ideas/ReviseIdeaPage";
import { OverviewTab } from "./features/ideas/OverviewTab";
import { HistoryTab } from "./features/ideas/HistoryTab";
import { VersionPage } from "./features/ideas/VersionPage";
import { AnalysisTab } from "./features/analysis/AnalysisTab";
import { EvaluationTab } from "./features/evaluation/EvaluationTab";
import { ImproveTab } from "./features/evaluation/ImproveTab";
import { ReviewTab } from "./features/review/ReviewTab";
import { ReviewQueuePage } from "./features/review/ReviewQueuePage";
import { RankingsPage } from "./features/rankings/RankingsPage";
import { ComparePage } from "./features/rankings/ComparePage";
import { DashboardPage } from "./features/rankings/DashboardPage";
import { CriteriaPage, ProfilesPage } from "./features/config/ConfigPages";
import { AuditPage, UsersPage } from "./features/admin/AdminPages";
import { DepartmentPage, PersonPage } from "./features/people/ScopedIdeaPages";
import { DataAndAiPage } from "./features/help/DataAndAiPage";
import { AppProviders } from "./app/providers";
import { RouteErrorBoundary } from "./app/error-boundary";
import { RequireAuth } from "./app/session";
import { canSee, useSession } from "./app/use-session";
import { api } from "./app/api-client";

/**
 * apps/web — P1 app shell.
 *
 * Routes are GENERATED from `navigation.map.ts` and filtered per role using the SAME
 * role lists the API enforces. That is SPEC §6.3 assertion 7: a route a role must not
 * reach is correctly absent for them, and absence is not an orphan.
 *
 * The client filter is convenience, never security — the API refuses independently, and
 * a user who types the URL gets a scoped message rather than data.
 */

const GROUPS: readonly { label: string; match: (id: string) => boolean }[] = [
  { label: "Ideas", match: (id) => ["ideas", "me.ideas", "ideas.new"].includes(id) },
  { label: "This idea", match: (id) => id.startsWith("idea.") },
  { label: "Rankings", match: (id) => id.startsWith("rankings") },
  { label: "Review", match: (id) => id.startsWith("review") },
  { label: "Leadership", match: (id) => id === "dashboard" },
  { label: "People & orgs", match: (id) => ["department", "person"].includes(id) },
  { label: "Config", match: (id) => id.startsWith("config") },
  { label: "Admin", match: (id) => id.startsWith("admin") },
  { label: "Help", match: (id) => id.startsWith("help") },
];

const demoPath = (path: string): string =>
  path
    .replace(":ideaId", "demo-idea")
    .replace(":versionNo", "1")
    .replace(":runId", "demo-run")
    .replace(":departmentId", "demo-dept")
    .replace(":userId", "demo-user");

function UserMenu() {
  const { data } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const logout = useMutation({
    mutationFn: () => api<{ ok: true }>("/auth/logout", { method: "POST" }),
    onSuccess: () => {
      // Clear every cached query: the next user must never see the last one's data.
      queryClient.clear();
      navigate("/login", { replace: true });
    },
  });

  if (!data) return null;
  return (
    <div className="user-menu">
      <div className="user-menu__who">
        <p className="user-menu__name">{data.user.displayName}</p>
        <p className="user-menu__roles">{data.user.roles.join(" · ")}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={() => logout.mutate()} disabled={logout.isPending}>
        Sign out
      </Button>
    </div>
  );
}

function Nav({ roles }: { roles: readonly Role[] }) {
  const { pathname } = useLocation();
  const visible = ROUTES.filter(
    (r) => !["login", "home"].includes(r.id) && canSee(roles, r.roles),
  );

  return (
    <nav aria-label="Main" className="dev-nav">
      <p className="dev-nav__title">
        IEP
        <span className="dev-nav__count">
          {visible.length} of {ROUTES.length}
        </span>
      </p>
      <UserMenu />
      {GROUPS.map((group) => {
        const items = visible.filter((r) => group.match(r.id));
        if (items.length === 0) return null;
        return (
          <section key={group.label} className="dev-nav__group">
            <h2 className="dev-nav__heading">{group.label}</h2>
            <ul>
              {items.map((route) => {
                const to = demoPath(route.path);
                return (
                  <li key={route.id}>
                    <Link to={to} aria-current={pathname === to ? "page" : undefined}>
                      {route.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}

/**
 * The catch-all, which has to tell two different stories.
 *
 * A URL matching no route is a typo. A URL matching a route this ROLE may not see is a
 * permission boundary, and answering "not found" there is a small lie that sends someone
 * hunting for a page which does exist. Both carry a way out (SPEC §6.3 assertion 3).
 *
 * This replaced the nav-map placeholder fallback, which used to produce the role message
 * as a side effect of rendering every unimplemented route. With all 25 routes real, that
 * fallback was gone — and the role message would have gone with it unnoticed.
 */
function Unreachable({ roles }: { roles: readonly Role[] }) {
  const { pathname } = useLocation();
  const known = matchRouteId(pathname);

  if (known && !canSee(roles, known.roles)) {
    return (
      <main className="page">
        <h1>Not available for your role</h1>
        <p className="muted">
          {known.title} is restricted to {known.roles.join(", ")}. You have{" "}
          {roles.join(", ") || "no roles"}.
        </p>
        <Link to="/ideas">Back to ideas</Link>
      </main>
    );
  }

  return (
    <main className="page">
      <h1>Not found</h1>
      <p className="muted">No route in the navigation map matches this URL.</p>
      <Link to="/ideas">Back to ideas</Link>
    </main>
  );
}

function Shell() {
  const { pathname } = useLocation();
  const { data } = useSession();
  const roles: readonly Role[] = data?.user.roles ?? [];

  /**
   * The client-side role gate, checked ONCE for whatever route matches.
   *
   * It used to be a side effect of the nav-map placeholder fallback, which wrapped every
   * route in a `canSee` check. Removing that fallback at P9 silently removed the gate
   * too: an employee opening /dashboard got the real page and a 403 from the API rather
   * than a straight answer about why. The E2E orphan hunt caught it.
   *
   * Convenience, never security — the API refuses independently (SPEC §4.2). What this
   * buys is an honest message instead of a broken-looking screen.
   */
  const matched = matchRouteId(pathname);
  if (matched && !canSee(roles, matched.roles)) {
    return (
      <div className="shell">
        <Nav roles={roles} />
        <div className="shell__main">
          <Unreachable roles={roles} />
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <Nav roles={roles} />
      <div className="shell__main">
        <RouteErrorBoundary resetKey={pathname}>
          <Routes>
            {/*
              P2 replaces the placeholder for the routes it implements. Everything else
              still renders from the nav map, so the shell stays walkable end to end and
              no route becomes a dead link mid-milestone.
            */}
            <Route path="/ideas" element={<IdeaListPage scope="all" />} />
            <Route path="/me/ideas" element={<IdeaListPage scope="mine" />} />
            <Route path="/ideas/new" element={<SubmitIdeaPage />} />
            <Route path="/ideas/:ideaId/overview" element={<OverviewTab />} />
            <Route path="/ideas/:ideaId/analysis" element={<AnalysisTab />} />
            <Route path="/ideas/:ideaId/evaluation" element={<EvaluationTab />} />
            <Route path="/ideas/:ideaId/improve" element={<ImproveTab />} />
            <Route path="/ideas/:ideaId/review" element={<ReviewTab />} />
            <Route path="/review" element={<ReviewQueuePage />} />
            {/* Static before dynamic: /rankings/compare must not be read as a run id. */}
            <Route path="/rankings/compare" element={<ComparePage />} />
            <Route path="/rankings/:runId" element={<RankingsPage mode="run" />} />
            <Route path="/rankings" element={<RankingsPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/config/criteria" element={<CriteriaPage />} />
            <Route path="/config/profiles" element={<ProfilesPage />} />
            <Route path="/admin/audit" element={<AuditPage />} />
            <Route path="/admin/users" element={<UsersPage />} />
            <Route path="/people/:userId" element={<PersonPage />} />
            <Route path="/departments/:departmentId" element={<DepartmentPage />} />
            <Route path="/help/data-and-ai" element={<DataAndAiPage />} />
            <Route path="/ideas/:ideaId/history" element={<HistoryTab />} />
            <Route path="/ideas/:ideaId/versions/:versionNo" element={<VersionPage />} />
            <Route path="/ideas/:ideaId/revise" element={<ReviseIdeaPage />} />

            {/*
              The nav-map placeholder fallback is GONE. Every one of the 25 routes has a
              real page as of P9, so a fallback here would only ever hide a routing
              mistake behind a plausible-looking stub.

              A role that may not see a route still gets the explicit "not available for
              your role" page below rather than a 404 — absence is not a dead end.
            */}
            <Route path="/" element={<Navigate to="/ideas" replace />} />
            <Route path="*" element={<Unreachable roles={roles} />} />
          </Routes>
        </RouteErrorBoundary>
      </div>
    </div>
  );
}

export function AppRouter() {
  return (
    <AppProviders>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="*"
            element={
              <RequireAuth>
                <Shell />
              </RequireAuth>
            }
          />
        </Routes>
      </BrowserRouter>
    </AppProviders>
  );
}
