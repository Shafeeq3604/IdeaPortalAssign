import { useQuery } from "@tanstack/react-query";
import type { PersonActivitySummary } from "@iep/contracts";
import { api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";

/**
 * A person's own activity summary + contribution timeline (SPEC §6.1 person page).
 *
 * Read-only, like `useSignals` — nothing here mutates, so there is no matching
 * `use*` write hook, just this one query.
 */
export function usePersonActivity(userId: string) {
  return useQuery({
    queryKey: queryKeys.people.activity(userId),
    queryFn: () => api<PersonActivitySummary>(`/people/${userId}/activity`),
    enabled: Boolean(userId),
  });
}
