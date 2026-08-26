import * as React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { Role, SessionResponse } from "@iep/contracts";
import { api, ApiError } from "./api-client";
import { queryKeys } from "./query-keys";

/** Session state and route guarding (FR-01). */

export function useSession() {
  return useQuery({
    queryKey: queryKeys.session(),
    queryFn: () => api<SessionResponse>("/auth/session"),
    // 401 is a normal answer here ("not signed in"), not an error worth retrying.
    retry: false,
    staleTime: 60_000,
  });
}

export function useActor(): { userId: string; roles: readonly Role[] } | null {
  const { data } = useSession();
  return data ? { userId: data.user.id, roles: data.user.roles } : null;
}

/**
 * Route guard. Unauthenticated users go to /login and come BACK to where they were —
 * losing the destination on sign-in is a small dead end (SPEC §6.3).
 */
export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { data, isPending, error } = useSession();
  const location = useLocation();

  if (isPending) {
    return (
      <main className="page" aria-busy="true">
        <p className="muted">Checking your session…</p>
      </main>
    );
  }

  const unauthenticated = !data || (error instanceof ApiError && error.status === 401);
  if (unauthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

/** Role-scoped rendering. Empty `roles` on a route means "any authenticated user". */
export function canSee(actorRoles: readonly Role[], routeRoles: readonly Role[]): boolean {
  return routeRoles.length === 0 || routeRoles.some((r) => actorRoles.includes(r));
}
