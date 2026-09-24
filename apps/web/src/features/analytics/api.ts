import { useQuery } from "@tanstack/react-query";
import type { AnalyticsResponse } from "@iep/contracts";
import { api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";

/** P14 organisational analytics (FR-27). */
export interface AnalyticsFilters {
  readonly departmentId?: string | undefined;
  readonly categoryId?: string | undefined;
}

export function useAnalytics(filters: AnalyticsFilters) {
  const qs = new URLSearchParams();
  if (filters.departmentId) qs.set("departmentId", filters.departmentId);
  if (filters.categoryId) qs.set("categoryId", filters.categoryId);
  const s = qs.toString();
  return useQuery({
    queryKey: queryKeys.analytics(filters),
    queryFn: () => api<AnalyticsResponse>(`/analytics${s ? `?${s}` : ""}`),
  });
}
