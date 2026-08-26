import { BrowserRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { ROUTES, breadcrumbChain } from "@iep/contracts";
import { RoutePlaceholder } from "./components/RoutePlaceholder";
import { ThemeCheck } from "./components/ThemeCheck";

/**
 * apps/web — P0.0 shell.
 *
 * The router is GENERATED FROM `navigation.map.ts`, never hand-written. That is the
 * whole point of doing it at P0: the navigation contract (SPEC §6) is wired in from the
 * first line instead of being retrofitted, and `pnpm test:nav` is already asserting
 * against the same source this router reads.
 *
 * Every page is a placeholder. Screens land in P1+.
 */

/** Group routes for the dev nav, so the shell is walkable without typing URLs. */
const GROUPS: readonly { label: string; match: (id: string) => boolean }[] = [
  { label: "Entry", match: (id) => ["login", "home"].includes(id) },
  { label: "Ideas", match: (id) => id.startsWith("idea") || id === "ideas" || id === "me.ideas" },
  { label: "Rankings", match: (id) => id.startsWith("rankings") },
  { label: "Review", match: (id) => id.startsWith("review") },
  { label: "Leadership", match: (id) => id === "dashboard" },
  { label: "People & orgs", match: (id) => ["department", "person"].includes(id) },
  { label: "Config", match: (id) => id.startsWith("config") },
  { label: "Admin", match: (id) => id.startsWith("admin") },
  { label: "Help", match: (id) => id.startsWith("help") },
];

/** Params are for real data later; here they just make the link navigable. */
function demoPath(path: string): string {
  return path
    .replace(":ideaId", "demo-idea")
    .replace(":versionNo", "1")
    .replace(":runId", "demo-run")
    .replace(":departmentId", "demo-dept")
    .replace(":userId", "demo-user");
}

function DevNav() {
  const { pathname } = useLocation();

  return (
    <nav aria-label="Routes" className="dev-nav">
      <p className="dev-nav__title">
        Navigation map
        <span className="dev-nav__count">{ROUTES.length} routes</span>
      </p>

      {GROUPS.map((group) => {
        const items = ROUTES.filter((r) => group.match(r.id));
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
  return (
    <div className="shell">
      <DevNav />
      <div className="shell__main">
        <Routes>
          {ROUTES.map((route) => (
            <Route
              key={route.id}
              path={route.path}
              element={
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
              }
            />
          ))}
          <Route
            path="/_theme"
            element={
              <main className="page">
                <h1>Theme check</h1>
                <p className="muted">P0.0 only — removed in P1.</p>
                <ThemeCheck />
              </main>
            }
          />
          <Route
            path="*"
            element={
              <main className="page">
                <h1>Not found</h1>
                <p className="muted">
                  No route in the navigation map matches this URL.
                </p>
                <Link to="/">Back to home</Link>
              </main>
            }
          />
        </Routes>
      </div>
    </div>
  );
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
