import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { matchRouteId, type Role } from "@iep/contracts";
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
import { AppShell } from "./app/AppShell";
import { RouteErrorBoundary } from "./app/error-boundary";
import { RequireAuth } from "./app/session";
import { canSee, useSession } from "./app/use-session";

/**
 * apps/web — routing.
 *
 * The shell (header, navigation, account menu) is `AppShell`. This file does one thing:
 * map a URL to a page, and answer honestly when it cannot.
 *
 * Role filtering is convenience, never security — the API refuses independently
 * (SPEC §4.2). What it buys is a straight answer instead of a page full of 403s.
 */

/**
 * The catch-all, which has to tell two different stories.
 *
 * A URL matching no route is a typo. A URL matching a route this ROLE may not see is a
 * permission boundary, and answering "not found" there is a small lie that sends someone
 * hunting for a page which does exist. Both carry a way out (SPEC §6.3 assertion 3).
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
          <Routes>
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

            <Route path="/" element={<Navigate to="/ideas" replace />} />
            <Route path="*" element={<Unreachable roles={roles} />} />
      </Routes>
      </RouteErrorBoundary>
    </AppShell>
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
