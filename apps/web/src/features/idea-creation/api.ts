import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateIdeaCreationConversationRequest, IdeaCreationConversation, IdeaCreationStatus,
  SendIdeaCreationMessageRequest, UpdateIdeaCreationDraftRequest,
} from "@iep/contracts";
import { api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";

/**
 * Platform-transformation brief §7 — conversational idea creation data access.
 *
 * Same polling shape as `features/discovery/api.ts`'s `useDiscoveryQuery` and
 * `features/analysis/api.ts`'s `useAnalysisStatus`: the frozen contract has no stream
 * endpoint, so a 2s poll on the conversation's own status meets "the AI's reply shows up
 * shortly after it's ready" without inventing new infrastructure.
 *
 * No `useIdeaCreationConversations` (list) hook — there is no "recent conversations"
 * picker in the UI yet to read it, and an unread query is just dead weight. Add it back
 * alongside whatever screen actually needs it.
 */

const LIVE: ReadonlySet<IdeaCreationStatus> = new Set(["AWAITING_AI"]);
const POLL_MS = 2_000;

export function useIdeaCreationConversation(conversationId: string | null) {
  return useQuery({
    queryKey: queryKeys.ideaCreation.detail(conversationId ?? ""),
    queryFn: () => api<IdeaCreationConversation>(`/idea-creation/conversations/${conversationId}`),
    enabled: Boolean(conversationId),
    refetchInterval: (query) => (query.state.data && LIVE.has(query.state.data.status) ? POLL_MS : false),
  });
}

export function useCreateIdeaCreationConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateIdeaCreationConversationRequest) =>
      api<IdeaCreationConversation>("/idea-creation/conversations", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (row) => {
      queryClient.setQueryData(queryKeys.ideaCreation.detail(row.id), row);
      // A cache write alone does not reliably re-arm `refetchInterval` on a query
      // observer that mounts in the same tick (the create → setConversationId → mount
      // sequence below) — an explicit refetch does, and is what actually starts the 2s
      // poll while the worker's turn is in flight (`status: "AWAITING_AI"`).
      void queryClient.refetchQueries({ queryKey: queryKeys.ideaCreation.detail(row.id) });
    },
  });
}

export function useSendIdeaCreationMessage(conversationId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SendIdeaCreationMessageRequest) =>
      api<IdeaCreationConversation>(`/idea-creation/conversations/${conversationId}/messages`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (row) => {
      queryClient.setQueryData(queryKeys.ideaCreation.detail(conversationId), row);
      // Same reasoning as `useCreateIdeaCreationConversation` above — force a real fetch
      // so the poll for the AI's reply actually starts.
      void queryClient.refetchQueries({ queryKey: queryKeys.ideaCreation.detail(conversationId) });
    },
  });
}

export function useUpdateIdeaCreationDraft(conversationId: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.ideaCreation.detail(conversationId);
  return useMutation({
    mutationFn: (body: UpdateIdeaCreationDraftRequest) =>
      api<IdeaCreationConversation>(`/idea-creation/conversations/${conversationId}/draft`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    // The 2s poll (while a turn is AWAITING_AI) keeps running during this mutation. A
    // poll request issued just before the PATCH can resolve just after it and overwrite
    // the correction back to the AI's pre-edit draft — cancel whatever's in flight before
    // this mutation's own `setQueryData` lands, so the correction always wins.
    onMutate: () => queryClient.cancelQueries({ queryKey: key }),
    onSuccess: (row) => {
      queryClient.setQueryData(key, row);
    },
  });
}
