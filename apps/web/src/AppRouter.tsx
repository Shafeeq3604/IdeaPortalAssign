import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ROUTES, breadcrumbChain, type Role } from "@iep/contracts";
import { Button } from "@iep/ui";
import { RoutePlaceholder } from "./components/RoutePlaceholder";
import { ThemeCheck, CrashTest } from "./components/ThemeCheck";
import { LoginPage } from "./features/auth/LoginPage";
import { IdeaListPage } from "./features/ideas/IdeaListPage";
import { SubmitIdeaPage } from "./features/ideas/SubmitIdeaPage";
import { ReviseIdeaPage } from "./features/ideas/ReviseIdeaPage";
import { OverviewTab } from "./features/ideas/OverviewTab";
import { HistoryTab } from "./features/ideas/HistoryTab";
import { AnalysisTab } from "./features/analysis/AnalysisTab";
import { EvaluationTab } from "./features/evaluation/EvaluationTab";
import { ImproveTab } from "./features/evaluation/ImproveTab";
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

function Shell() {
  const { pathname } = useLocation();
  const { data } = useSession();
  const roles: readonly Role[] = data?.user.roles ?? [];

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
            <Route path="/ideas/:ideaId/history" element={<HistoryTab />} />
            <Route path="/ideas/:ideaId/revise" element={<ReviseIdeaPage />} />

            {ROUTES.filter((r) => !["login", "home"].includes(r.id))
              .filter(
                (r) =>
                  !["ideas", "me.ideas", "ideas.new", "idea.overview", "idea.analysis", "idea.evaluation", "idea.improve",
                    "idea.history", "idea.revise"].includes(
                    r.id,
                  ),
              )
              .map((route) => (
              <Route
                key={route.id}
                path={route.path}
                element={
                  canSee(roles, route.roles) ? (
                    <RoutePlaceholder
                      routeId={route.id}
                      title={route.title}
                      path={route.path}
                      roles={route.roles}
                      renders={route.renders}
                      searchParams={route.searchParams}
                      backPath={route.backPath}
                      crumbs={breadcrumbChain(route.id).map((c) => c.title)}
                    />
                  ) : (
                    // Not a dead end: says why, and offers the way out (SPEC §6.3).
                    <main className="page">
                      <h1>Not available for your role</h1>
                      <p className="muted">
                        Restricted to {route.roles.join(", ")}. You have{" "}
                        {roles.join(", ") || "no roles"}.
                      </p>
                      <Link to="/ideas">Back to ideas</Link>
                    </main>
                  )
                }
              />
            ))}
            <Route
              path="/_theme"
              element={
                <main className="page">
                  <h1>Theme check</h1>
                  <p className="muted">P0.0 scaffold — removed at P1 close.</p>
                  <ThemeCheck />
                </main>
              }
            />
            <Route path="/_boom" element={<CrashTest />} />
            <Route path="/" element={<Navigate to="/ideas" replace />} />
            <Route
              path="*"
              element={
                <main className="page">
                  <h1>Not found</h1>
                  <p className="muted">No route in the navigation map matches this URL.</p>
                  <Link to="/ideas">Back to ideas</Link>
                </main>
              }
            />
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
