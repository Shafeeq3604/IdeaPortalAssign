import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateIdeaCommentRequest, IdeaComment, IdeaDetail, IdeaFollowState, ListIdeaCommentsResponse,
  SearchPeopleResponse, UpdateIdeaCommentRequest,
} from "@iep/contracts";
import { api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";

/**
 * P18 — the social layer's data access: the comment thread, following, and the @ picker.
 *
 * Comments confirm server-side before they appear (not optimistic like a vote): a post
 * notifies people, so the thread should never show a comment the server refused. Follow
 * IS optimistic — like a vote, it is a preference, not a decision, and a bell that waits
 * a round trip feels broken.
 */

export function useComments(ideaId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.ideas.comments(ideaId),
    queryFn: () => api<ListIdeaCommentsResponse>(`/ideas/${ideaId}/comments`),
    enabled: Boolean(ideaId) && enabled,
  });
}

/** After any change to the thread: the thread itself, and the idea (its comment count + follow state). */
function useRefreshThread(ideaId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: queryKeys.ideas.comments(ideaId) });
    void qc.invalidateQueries({ queryKey: queryKeys.ideas.detail(ideaId), exact: true });
  };
}

export function useCreateComment(ideaId: string) {
  const refresh = useRefreshThread(ideaId);
  return useMutation({
    mutationFn: (body: CreateIdeaCommentRequest) =>
      api<IdeaComment>(`/ideas/${ideaId}/comments`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: refresh,
  });
}

export function useUpdateComment(ideaId: string) {
  const refresh = useRefreshThread(ideaId);
  return useMutation({
    mutationFn: ({ commentId, ...body }: UpdateIdeaCommentRequest & { commentId: string }) =>
      api<IdeaComment>(`/comments/${commentId}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: refresh,
  });
}

export function useDeleteComment(ideaId: string) {
  const refresh = useRefreshThread(ideaId);
  return useMutation({
    mutationFn: (commentId: string) => api<IdeaComment>(`/comments/${commentId}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
}

export function useHideComment(ideaId: string) {
  const qc = useQueryClient();
  const refresh = useRefreshThread(ideaId);
  return useMutation({
    mutationFn: ({ commentId, reason }: { commentId: string; reason: string }) =>
      api<IdeaComment>(`/comments/${commentId}/hide`, { method: "POST", body: JSON.stringify({ reason }) }),
    onSuccess: () => {
      refresh();
      void qc.invalidateQueries({ queryKey: queryKeys.admin.audit({}) });
    },
  });
}

export function useFollow(ideaId: string) {
  const qc = useQueryClient();
  const key = queryKeys.ideas.detail(ideaId);
  return useMutation({
    mutationFn: (following: boolean) =>
      api<IdeaFollowState>(`/ideas/${ideaId}/follow`, { method: "POST", body: JSON.stringify({ following }) }),
    onMutate: async (following) => {
      await qc.cancelQueries({ queryKey: key, exact: true });
      const previous = qc.getQueryData<IdeaDetail>(key);
      if (previous) {
        const delta = following === previous.social.following ? 0 : following ? 1 : -1;
        qc.setQueryData<IdeaDetail>(key, {
          ...previous,
          social: { following, followerCount: Math.max(0, previous.social.followerCount + delta) },
        });
      }
      return { previous };
    },
    onError: (_e, _v, context) => {
      if (context?.previous) qc.setQueryData(key, context.previous);
    },
    onSuccess: (state) => {
      const current = qc.getQueryData<IdeaDetail>(key);
      if (current) {
        qc.setQueryData<IdeaDetail>(key, {
          ...current,
          social: { following: state.following, followerCount: state.followerCount },
        });
      }
    },
  });
}

/** The @ picker. Only asks once there is something to match, and keeps the last list up while typing. */
export function usePeopleSearch(q: string, ideaId: string) {
  const term = q.trim();
  return useQuery({
    queryKey: queryKeys.people.search(term, ideaId),
    queryFn: () =>
      api<SearchPeopleResponse>(`/directory/people?${new URLSearchParams({ q: term, ideaId }).toString()}`),
    enabled: term.length >= 1,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
