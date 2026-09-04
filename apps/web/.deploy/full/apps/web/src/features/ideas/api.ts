import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateIdeaRequest, CreateVersionRequest, IdeaDetail, IdeaHistoryResponse,
  IdeaStatus, ListIdeasQuery, ListIdeasResponse, ListVersionsResponse, TransitionRequest,
} from "@iep/contracts";
import { api } from "../../app/api-client";
import { invalidateAfter, queryKeys } from "../../app/query-keys";

/**
 * Idea data access (P2).
 *
 * Every key comes from the factory and every mutation invalidates via `invalidateAfter`,
 * so a new screen cannot invent its own cache key or forget what a write affects.
 */

/**
 * Arrays become REPEATED keys (`status=A&status=B`), not a comma-joined string.
 * That is what Fastify's parser turns back into an array, and what the contract's
 * `z.array(IdeaStatus)` expects — a joined string fails validation.
 */
const qs = (params: Record<string, string | number | readonly string[] | undefined>): string => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    if (Array.isArray(v)) for (const item of v) s.append(k, String(item));
    else s.set(k, String(v));
  }
  const out = s.toString();
  return out ? `?${out}` : "";
};

/**
 * `sort` is a closed set, not a string — the contract's query schema defines the values,
 * so a typo becomes a compile error here rather than a 400 at runtime.
 */
export type IdeaSort = ListIdeasQuery["sort"];

export interface IdeaListFilters {
  readonly page?: number;
  readonly status?: readonly IdeaStatus[] | undefined;
  readonly submitterId?: string | undefined;
  readonly q?: string | undefined;
  readonly sort?: IdeaSort | undefined;
}

const SORTS: readonly IdeaSort[] = ["recent", "oldest", "title", "status", "rank"];

/** URL params are user-controlled; narrow an unknown value instead of trusting it. */
export function parseSort(value: string | null): IdeaSort {
  return SORTS.includes(value as IdeaSort) ? (value as IdeaSort) : "recent";
}

export function useIdeaList(filters: IdeaListFilters) {
  return useQuery({
    queryKey: queryKeys.ideas.list(filters),
    queryFn: () => api<ListIdeasResponse>(`/ideas${qs({ ...filters })}`),
  });
}

export function useIdea(ideaId: string) {
  return useQuery({
    queryKey: queryKeys.ideas.detail(ideaId),
    queryFn: () => api<IdeaDetail>(`/ideas/${ideaId}`),
    enabled: Boolean(ideaId),
  });
}

export function useIdeaVersions(ideaId: string) {
  return useQuery({
    queryKey: queryKeys.ideas.versions(ideaId),
    queryFn: () => api<ListVersionsResponse>(`/ideas/${ideaId}/versions`),
    enabled: Boolean(ideaId),
  });
}

export function useIdeaHistory(ideaId: string) {
  return useQuery({
    queryKey: queryKeys.ideas.history(ideaId),
    queryFn: () => api<IdeaHistoryResponse>(`/ideas/${ideaId}/history`),
    enabled: Boolean(ideaId),
  });
}

export function useCreateIdea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateIdeaRequest) =>
      api<{ ideaId: string }>("/ideas", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.ideas.all() }),
  });
}

export function useCreateVersion(ideaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateVersionRequest) =>
      api<{ ideaId: string }>(`/ideas/${ideaId}/versions`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      for (const key of invalidateAfter.newVersion(ideaId)) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}

export function useTransition(ideaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TransitionRequest) =>
      api<IdeaDetail>(`/ideas/${ideaId}/status`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      for (const key of invalidateAfter.statusTransition(ideaId)) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}

/** Status → human label. The enum is a contract; the wording is presentation. */
export const STATUS_LABEL: Record<IdeaStatus, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  AI_ANALYSIS: "Being analysed",
  NEEDS_CLARIFICATION: "Needs clarification",
  EVALUATED: "Evaluated",
  RANKED: "Ranked",
  UNDER_REVIEW: "Under review",
  PROTOTYPE_CANDIDATE: "Prototype candidate",
  PILOT: "Pilot",
  PRODUCTION_CANDIDATE: "Production candidate",
  IMPLEMENTED: "Implemented",
  PARKED: "Parked",
  BLOCKED: "Blocked",
  REJECTED: "Rejected",
  ARCHIVED: "Archived",
};
