import { useQuery } from "@tanstack/react-query";
import type { Role, SessionResponse } from "@iep/contracts";
import { api } from "./api-client";
import { queryKeys } from "./query-keys";

/**
 * Session reads and role helpers (FR-01).
 *
 * Split out of `session.tsx` so that file exports a component and nothing else: a
 * module that mixes the two breaks React Fast Refresh, which is why eslint rejects it.
 */

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

/** Role-scoped rendering. Empty `roles` on a route means "any authenticated user". */
export function canSee(actorRoles: readonly Role[], routeRoles: readonly Role[]): boolean {
  return routeRoles.length === 0 || routeRoles.some((r) => actorRoles.includes(r));
}
