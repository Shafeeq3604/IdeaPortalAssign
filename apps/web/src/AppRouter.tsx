import { lazy, Suspense } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { matchRouteId, type Role } from "@iep/contracts";
import { Skeleton } from "@iep/ui";
import { AppProviders } from "./app/providers";
import { AppShell } from "./app/AppShell";
import { RouteErrorBoundary } from "./app/error-boundary";
import { RequireAuth } from "./app/session";
import { canSee, useSession } from "./app/use-session";
import { useDocumentTitle } from "./app/use-document-title";
import { LoginPage } from "./features/auth/LoginPage";
import { SignupPage } from "./features/auth/SignupPage";
import { IdeaListPage } from "./features/ideas/IdeaListPage";
import { OverviewTab } from "./features/ideas/OverviewTab";
import { HistoryTab } from "./features/ideas/HistoryTab";
import { AnalysisTab } from "./features/analysis/AnalysisTab";
import { EvaluationTab } from "./features/evaluation/EvaluationTab";
import { RankingsPage } from "./features/rankings/RankingsPage";

/**
 * apps/web — routing.
 *
 * The shell (header, navigation, account menu) is `AppShell`. This file does one thing:
 * map a URL to a page, and answer honestly when it cannot.
 *
 * Role filtering is convenience, never security — the API refuses independently
 * (SPEC §4.2). What it buys is a straight answer instead of a page full of 403s.
 *
 * A first split made EVERY page `lazy()`, on the theory that a fresh navigation would
 * only ever download the one page it renders. Measured against SPEC §11.6's Lighthouse
 * budget, that made LCP slightly WORSE on exactly the three routes the budget audits
 * (`/ideas`, an idea's own `/evaluation`, `/rankings`): the shared vendor/app chunks
 * still have to load and execute before a lazy import() is even discovered, so those
 * routes paid a real extra network round-trip for no byte savings on the audited path.
 *
 * This is the corrected split: the login screen and the idea-browsing → evaluation →
 * ranking loop — the path SPEC actually measures and the one most sessions live in —
 * are ordinary static imports, bundled once with no lazy indirection. Everything reached
 * less often (admin, config, discovery, compare, the review queue, the submission and
 * revision forms, person/department pages) stays `lazy()`, so a session that never opens
 * those still never downloads them.
 */

const SubmitIdeaPage = lazy(() => import("./features/ideas/SubmitIdeaPage").then((m) => ({ default: m.SubmitIdeaPage })));
const ReviseIdeaPage = lazy(() => import("./features/ideas/ReviseIdeaPage").then((m) => ({ default: m.ReviseIdeaPage })));
const VersionPage = lazy(() => import("./features/ideas/VersionPage").then((m) => ({ default: m.VersionPage })));
const ReviewTab = lazy(() => import("./features/review/ReviewTab").then((m) => ({ default: m.ReviewTab })));
const ReviewQueuePage = lazy(() => import("./features/review/ReviewQueuePage").then((m) => ({ default: m.ReviewQueuePage })));
const ComparePage = lazy(() => import("./features/rankings/ComparePage").then((m) => ({ default: m.ComparePage })));
const DashboardPage = lazy(() => import("./features/rankings/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const CriteriaPage = lazy(() => import("./features/config/ConfigPages").then((m) => ({ default: m.CriteriaPage })));
const ProfilesPage = lazy(() => import("./features/config/ConfigPages").then((m) => ({ default: m.ProfilesPage })));
const AuditPage = lazy(() => import("./features/admin/AdminPages").then((m) => ({ default: m.AuditPage })));
const UsersPage = lazy(() => import("./features/admin/AdminPages").then((m) => ({ default: m.UsersPage })));
const DepartmentPage = lazy(() => import("./features/people/ScopedIdeaPages").then((m) => ({ default: m.DepartmentPage })));
const PersonPage = lazy(() => import("./features/people/ScopedIdeaPages").then((m) => ({ default: m.PersonPage })));
const DataAndAiPage = lazy(() => import("./features/help/DataAndAiPage").then((m) => ({ default: m.DataAndAiPage })));
const DiscoveryChatPage = lazy(() => import("./features/discovery/DiscoveryChatPage").then((m) => ({ default: m.DiscoveryChatPage })));

/** A quiet placeholder while a route's own chunk downloads — the shell (header, nav)
 * is never part of this, since `AppShell` wraps it rather than sitting inside it. */
function RouteFallback() {
  return (
    <main className="page" aria-busy="true">
      <Skeleton className="h-8 w-1/3" />
      <div className="mt-4 space-y-3">
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="h-40 w-full" />
      </div>
    </main>
  );
}

/**
 * The catch-all, which has to tell two different stories.
 *
 * A URL matching no route is a typo. A URL matching a route this ROLE may not see is a
 * permission boundary, and answering "not found" there is a small lie that sends someone
 * hunting for a page which does exist. Both carry a way out (SPEC §6.3 assertion 3).
 */
/** "REVIEWER" → "Reviewer" — the same humanising the role checklist and badges use
 *  (AppShell.tsx, UserForms.tsx). This screen was printing the raw enum instead. */
const roleLabel = (role: Role): string => role.charAt(0) + role.slice(1).toLowerCase();

function Unreachable({ roles }: { roles: readonly Role[] }) {
  const { pathname } = useLocation();
  const known = matchRouteId(pathname);

  if (known && !canSee(roles, known.roles)) {
    return (
      <main className="page page--narrow">
        <h1>Not available for your role</h1>
        <p className="muted">
          {known.title} is restricted to {known.roles.map(roleLabel).join(", ")}. You
          have {roles.length > 0 ? roles.map(roleLabel).join(", ") : "no roles"}.
        </p>
        <Link to="/ideas">Back to ideas</Link>
      </main>
    );
  }

  return (
    <main className="page page--narrow">
      <h1>Not found</h1>
      <p className="muted">No page matches this address.</p>
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
      <AppShell>
        <Unreachable roles={roles} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <RouteErrorBoundary resetKey={pathname}>
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/ideas" element={<IdeaListPage scope="all" />} />
            <Route path="/me/ideas" element={<IdeaListPage scope="mine" />} />
            <Route path="/ideas/new" element={<SubmitIdeaPage />} />
            <Route path="/ideas/:ideaId/overview" element={<OverviewTab />} />
            <Route path="/ideas/:ideaId/analysis" element={<AnalysisTab />} />
            <Route path="/ideas/:ideaId/evaluation" element={<EvaluationTab />} />
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
            <Route path="/discovery" element={<DiscoveryChatPage />} />
            <Route path="/ideas/:ideaId/history" element={<HistoryTab />} />
            <Route path="/ideas/:ideaId/versions/:versionNo" element={<VersionPage />} />
            <Route path="/ideas/:ideaId/revise" element={<ReviseIdeaPage />} />

            <Route path="/" element={<Navigate to="/ideas" replace />} />
            <Route path="*" element={<Unreachable roles={roles} />} />
          </Routes>
        </Suspense>
      </RouteErrorBoundary>
    </AppShell>
  );
}

/** Renders nothing — just keeps the browser tab in sync with the current route. */
function DocumentTitle() {
  useDocumentTitle();
  return null;
}

export function AppRouter() {
  return (
    <AppProviders>
      <BrowserRouter>
        {/* Sign-in/sign-up sit outside `Shell` (no session yet to gate on), so the title
            hook lives here instead — one level up, so every route gets it regardless of
            auth state, rather than duplicating the call inside both branches. */}
        <DocumentTitle />
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route
              path="*"
              element={
                <RequireAuth>
                  <Shell />
                </RequireAuth>
              }
            />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AppProviders>
  );
}
