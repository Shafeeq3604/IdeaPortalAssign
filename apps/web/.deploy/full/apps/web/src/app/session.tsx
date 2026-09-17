import * as React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ErrorState } from "@iep/ui";
import { ApiError, ApiUnreachableError } from "./api-client";
import { useSession } from "./use-session";
import { PRODUCT_SHORT } from "./product";
import { BrandMark } from "./BrandMark";

/** Route guarding (FR-01). Hooks and role helpers live in ./use-session. */

/**
 * Route guard. Unauthenticated users go to /login and come BACK to where they were —
 * losing the destination on sign-in is a small dead end (SPEC §6.3).
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { data, isPending, error, refetch } = useSession();
  const location = useLocation();

  if (isPending) {
    // A bare, unstyled "loading" line here — even for the second or two this usually
    // takes — is the very first thing anyone sees on every visit and every refresh, and a
    // plain grey page with no branding reads as broken, not busy. Showing the same header
    // bar the real app uses means the transition into the signed-in shell is seamless
    // rather than a flash from "nothing" to "the product."
    return (
      <div className="min-h-dvh">
        <header className="brand-bar flex h-14 items-center gap-3 px-4 text-grad-ink shadow-e2">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-grad-highlight/20 ring-1 ring-grad-rule">
            <BrandMark className="size-3.5 text-grad-highlight" />
          </span>
          <span className="truncate text-200 font-semibold text-grad-ink">{PRODUCT_SHORT}</span>
        </header>
        <main className="page page--narrow" aria-busy="true" aria-live="polite">
          <span className="sr-only">Checking your session…</span>
          <div className="mx-auto mt-16 flex max-w-sm flex-col items-center gap-3 text-center" aria-hidden="true">
            <span className="size-8 animate-spin rounded-full border-2 border-accent-200 border-t-accent-600" />
            <p className="text-200 text-muted-foreground">Just a moment…</p>
          </div>
        </main>
      </div>
    );
  }

  // API down is NOT the same as signed out. Redirecting to /login would hide the real
  // cause behind a login page that also cannot load.
  if (error instanceof ApiUnreachableError) {
    return (
      <main className="page page--narrow">
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
