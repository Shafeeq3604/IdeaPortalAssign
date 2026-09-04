import * as React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ErrorState } from "@iep/ui";
import { ApiError, ApiUnreachableError } from "./api-client";
import { useSession } from "./use-session";

/** Route guarding (FR-01). Hooks and role helpers live in ./use-session. */

/**
 * Route guard. Unauthenticated users go to /login and come BACK to where they were —
 * losing the destination on sign-in is a small dead end (SPEC §6.3).
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { data, isPending, error, refetch } = useSession();
  const location = useLocation();

  if (isPending) {
    return (
      <main className="page" aria-busy="true">
        <p className="muted">Checking your session…</p>
      </main>
    );
  }

  // API down is NOT the same as signed out. Redirecting to /login would hide the real
  // cause behind a login page that also cannot load.
  if (error instanceof ApiUnreachableError) {
    return (
      <main className="page">
        <ErrorState
          title="The API server is not running"
          description="The web app is up, but nothing is answering on port 3001. Start both processes with: corepack pnpm dev"
          onRetry={() => void refetch()}
          escapeTo={{ label: "Reload the page", to: "/" }}
          renderLink={({ to, children, className }) => (<a href={to} className={className}>{children}</a>)}
        />
      </main>
    );
  }

  const unauthenticated = !data || (error instanceof ApiError && error.status === 401);
  if (unauthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}
