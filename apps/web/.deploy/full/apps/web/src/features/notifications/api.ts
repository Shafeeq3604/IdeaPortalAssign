import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  ListNotificationsResponse, MarkNotificationsReadResponse, NotificationPreferencesResponse,
  UpdateNotificationPreferencesRequest,
} from "@iep/contracts";
import { api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";

/** P13 notification centre data access (FR-28). */

export function useNotifications(filters: { page: number; unread: boolean }) {
  const qs = new URLSearchParams({ page: String(filters.page) });
  if (filters.unread) qs.set("unread", "true");
  return useQuery({
    queryKey: queryKeys.notifications.list(filters),
    queryFn: () => api<ListNotificationsResponse>(`/notifications?${qs.toString()}`),
  });
}

/**
 * The header bell's count. Polled, not pushed: a minute is prompt enough for "someone
 * reviewed your idea", and it costs one indexed COUNT per signed-in tab. Paused while the
 * tab is hidden (TanStack's default), so a background tab costs nothing.
 */
export function useUnreadCount(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.notifications.unread(),
    queryFn: async () => (await api<ListNotificationsResponse>("/notifications?perPage=1")).unreadCount,
    enabled,
    refetchInterval: 60_000,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids?: readonly string[]) =>
      api<MarkNotificationsReadResponse>("/notifications/read", {
        method: "POST",
        body: JSON.stringify(ids ? { ids } : {}),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.notifications.all() }),
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: queryKeys.notifications.preferences(),
    queryFn: () => api<NotificationPreferencesResponse>("/notifications/preferences"),
  });
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateNotificationPreferencesRequest) =>
      api<NotificationPreferencesResponse>("/notifications/preferences", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => qc.setQueryData(queryKeys.notifications.preferences(), data),
  });
}
