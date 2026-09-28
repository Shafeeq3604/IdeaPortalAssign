import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AddDeliveryUpdateRequest, AddKpiMeasurementRequest, CreateKpiRequest, IdeaDeliveryResponse,
  UpdateFinancialsRequest, UpdatePilotRequest,
} from "@iep/contracts";
import { api } from "../../app/api-client";
import { queryKeys } from "../../app/query-keys";

/** P15/P16 delivery tracking data access. Every write answers with the whole tab's state. */

export function useDelivery(ideaId: string) {
  return useQuery({
    queryKey: queryKeys.ideas.delivery(ideaId),
    queryFn: () => api<IdeaDeliveryResponse>(`/ideas/${ideaId}/delivery`),
    enabled: Boolean(ideaId),
  });
}

function useDeliveryWrite<TVars>(
  ideaId: string,
  method: "POST" | "PATCH",
  request: (vars: TVars) => { path: string; body: unknown },
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: TVars) => {
      const { path, body } = request(vars);
      return api<IdeaDeliveryResponse>(path, { method, body: JSON.stringify(body) });
    },
    onSuccess: (data) => {
      qc.setQueryData(queryKeys.ideas.delivery(ideaId), data);
      // Maturity reads KPI count and pilot existence, and the audit trail gains a row.
      void qc.invalidateQueries({ queryKey: queryKeys.ideas.evaluation(ideaId) });
    },
  });
}

export const useAddDeliveryUpdate = (ideaId: string) =>
  useDeliveryWrite<AddDeliveryUpdateRequest>(ideaId, "POST", (body) => ({ path: `/ideas/${ideaId}/delivery/updates`, body }));
export const useUpdatePilot = (ideaId: string) =>
  useDeliveryWrite<UpdatePilotRequest>(ideaId, "PATCH", (body) => ({ path: `/ideas/${ideaId}/delivery/pilot`, body }));
export const useCreateKpi = (ideaId: string) =>
  useDeliveryWrite<CreateKpiRequest>(ideaId, "POST", (body) => ({ path: `/ideas/${ideaId}/kpis`, body }));
export const useAddMeasurement = (ideaId: string) =>
  // `kpiId` builds the URL; only `body` is sent.
  useDeliveryWrite<{ kpiId: string; body: AddKpiMeasurementRequest }>(
    ideaId, "POST", (v) => ({ path: `/ideas/${ideaId}/kpis/${v.kpiId}/measurements`, body: v.body }),
  );
export const useUpdateFinancials = (ideaId: string) =>
  useDeliveryWrite<UpdateFinancialsRequest>(ideaId, "PATCH", (body) => ({ path: `/ideas/${ideaId}/financials`, body }));
