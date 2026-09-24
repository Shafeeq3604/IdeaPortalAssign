import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CompareResponse, DashboardResponse, ListProfilesResponse, ListRankingsResponse,
  OkResponse, RankingRunMeta, RecomputeRequest, UpdateProfileWeightsRequest,
} from "@iep/contracts";
import { api } from "../../app/api-client";
import { invalidateAfter, queryKeys } from "../../app/query-keys";

/** Ranked board, comparison and dashboard data access (P7). */

export interface BoardFilters {
  readonly page?: number;
  readonly profile?: string | undefined;
  readonly departmentId?: string | undefined;
  readonly rankBand?: string | undefined;
}

const qs = (params: Record<string, string | number | undefined>): string => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    s.set(k, String(v));
  }
  const out = s.toString();
  return out ? `?${out}` : "";
};

export function useRankings(filters: BoardFilters) {
  return useQuery({
    queryKey: queryKeys.rankings.list(filters),
    queryFn: () => api<ListRankingsResponse>(`/rankings${qs({ ...filters })}`),
  });
}

export function useRankingRun(
  runId: string,
  filters: { readonly page?: number; readonly rankBand?: string | undefined } = {},
) {
  return useQuery({
    // `getRankingRun` (apps/api) reads and applies `page`/`rankBand` for a historic run
    // exactly like `getRankings` does for the live board — this key used to carry only
    // `runId`, so paging or switching rank bands on a historic run changed the URL but
    // never produced a new query key, and the same page-1/all-band response stayed on
    // screen.
    queryKey: queryKeys.rankings.run(runId, filters),
    queryFn: () => api<ListRankingsResponse>(`/rankings/${runId}${qs({ ...filters })}`),
    enabled: Boolean(runId),
    // An immutable snapshot (ADR-008) cannot change, so refetching the SAME page/band is
    // pure waste — but each distinct (page, rankBand) is its own query key above, so this
    // only avoids a refetch of a page already fetched, not a switch to a different one.
    staleTime: Infinity,
  });
}

export function useCompare(ids: readonly string[], profile?: string) {
  return useQuery({
    queryKey: queryKeys.rankings.compare(ids, profile),
    queryFn: () => {
      const s = new URLSearchParams();
      for (const id of ids) s.append("ids", id);
      if (profile) s.set("profile", profile);
      return api<CompareResponse>(`/rankings/compare?${s.toString()}`);
    },
    enabled: ids.length >= 2 && ids.length <= 4,
  });
}

export function useProfiles() {
  return useQuery({
    queryKey: queryKeys.config.profiles(),
    queryFn: () => api<ListProfilesResponse>("/config/profiles"),
    // Config changes rarely and every board render needs it.
    staleTime: 5 * 60_000,
  });
}

export function useDashboard(departmentId?: string) {
  return useQuery({
    queryKey: queryKeys.dashboard(departmentId),
    queryFn: () => api<DashboardResponse>(`/dashboard${qs({ departmentId })}`),
  });
}

export function useRecompute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RecomputeRequest) =>
      api<RankingRunMeta>("/rankings/recompute", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      for (const key of invalidateAfter.recompute()) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}

/** P10 (FR-13) — replaces a profile's whole weight set. Does not itself move a rank
 *  (ADR-008: rankings are immutable snapshot runs) — `invalidateAfter.profileWeightsUpdate`
 *  refreshes config + the audit trail only, deliberately not `rankings`/`dashboard`. */
export function useUpdateProfileWeights() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ profileKey, ...body }: UpdateProfileWeightsRequest & { profileKey: string }) =>
      api<OkResponse>(`/config/profiles/${profileKey}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      for (const key of invalidateAfter.profileWeightsUpdate()) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}
