import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CompareResponse, DashboardResponse, ListProfilesResponse, ListRankingsResponse,
  RankingRunMeta, RecomputeRequest,
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

export function useRankingRun(runId: string) {
  return useQuery({
    queryKey: queryKeys.rankings.run(runId),
    queryFn: () => api<ListRankingsResponse>(`/rankings/${runId}`),
    enabled: Boolean(runId),
    // An immutable snapshot (ADR-008) cannot change, so refetching one is pure waste.
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
