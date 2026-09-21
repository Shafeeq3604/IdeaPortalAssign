import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError, ApiUnreachableError } from "./api-client";
import { queryKeys } from "./query-keys";

/**
 * App-wide providers (P0 deliverable 5c).
 *
 * Defaults live here so every slice inherits the same caching behaviour instead of each
 * one inventing its own staleTime — a difference that shows up as "why is this screen
 * stale and that one isn't".
 */

export function createQueryClient(): QueryClient {
  /**
   * A session that expires mid-page used to have no recovery path outside the initial
   * route mount: `RequireAuth` (session.tsx) only redirects to `/login` off `useSession()`,
   * which is cached for 60s and nothing invalidated it early. A 401 on some OTHER query or
   * mutation (submitting a form, recording a review, anything after a period of
   * inactivity) surfaced as whatever generic error copy that one call site renders, never
   * as "your session expired, sign in again."
   *
   * 401 means exactly one thing everywhere in this API — UNAUTHENTICATED or
   * SESSION_EXPIRED are its only two sources (packages/contracts/src/errors.ts); an
   * authenticated-but-forbidden request is a 403, never a 401 — so reacting to any 401
   * here is safe, not a guess. Setting the session query's own cached data to `null`
   * reuses `RequireAuth`'s existing, already-correct "unauthenticated ⇒ redirect to
   * /login with `from`" logic instead of duplicating a second redirect path.
   */
  const onPossibleSessionExpiry = (error: unknown): void => {
    if (error instanceof ApiError && error.status === 401) {
      qc.setQueryData(queryKeys.session(), null);
    }
  };

  const qc = new QueryClient({
    queryCache: new QueryCache({ onError: onPossibleSessionExpiry }),
    mutationCache: new MutationCache({ onError: onPossibleSessionExpiry }),
    defaultOptions: {
      queries: {
        // Server state is authoritative; a short window avoids refetch storms while
        // navigating between the idea tabs.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // The API is not running. Retrying cannot succeed within this query's life —
          // it only floods the proxy log and delays the message that tells the developer
          // what to actually do. Surface it immediately; the UI offers a retry button.
          if (error instanceof ApiUnreachableError) return false;

          // Never retry a deliberate refusal — 4xx means the request was wrong,
          // and retrying an authz failure just burns the rate limit.
          const status = (error as { status?: number }).status;
          if (status && status >= 400 && status < 500) return false;

          return failureCount < 2;
        },
      },
      mutations: {
        // Mutations here are audited decisions (overrides, transitions). Never auto-retry:
        // a duplicate is worse than a visible failure (SPEC §8.4).
        retry: false,
      },
    },
  });
  return qc;
}
