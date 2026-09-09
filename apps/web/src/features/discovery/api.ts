import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateDiscoveryQueryRequest, DiscoveryQueryResponse, DiscoveryStatus,
  ListDiscoveryQueriesResponse,
} from "@iep/contracts";
import { api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";

/**
 * SPC-001 — AI Discovery Agent data access.
 *
 * Same polling shape as `features/analysis/api.ts`'s `useAnalysisStatus`: the frozen
 * contract has no stream endpoint, so a 2s poll on the query's own status meets "answer
 * shows up shortly after it's ready" without inventing new infrastructure. Recorded in
 * docs/adr/CONTRACT-LOG.md alongside the analysis pipeline's identical choice.
 */

const LIVE: ReadonlySet<DiscoveryStatus> = new Set(["PENDING", "RUNNING"]);
const POLL_MS = 2_000;

export function useDiscoveryHistory() {
  return useQuery({
    queryKey: queryKeys.discovery.history(),
    queryFn: () => api<ListDiscoveryQueriesResponse>("/discovery/queries"),
  });
}

export function useDiscoveryQuery(discoveryQueryId: string | null) {
  return useQuery({
    queryKey: queryKeys.discovery.detail(discoveryQueryId ?? ""),
    queryFn: () => api<DiscoveryQueryResponse>(`/discovery/queries/${discoveryQueryId}`),
    enabled: Boolean(discoveryQueryId),
    refetchInterval: (query) => (query.state.data && LIVE.has(query.state.data.status) ? POLL_MS : false),
  });
}

export function useCreateDiscoveryQuery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDiscoveryQueryRequest) =>
      api<DiscoveryQueryResponse>("/discovery/queries", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.discovery.history() });
    },
  });
}
