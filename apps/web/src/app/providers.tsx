import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * App-wide providers (P0 deliverable 5c).
 *
 * Defaults live here so every slice inherits the same caching behaviour instead of each
 * one inventing its own staleTime — a difference that shows up as "why is this screen
 * stale and that one isn't".
 */

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Server state is authoritative; a short window avoids refetch storms while
        // navigating between the idea tabs.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
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
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(createQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
