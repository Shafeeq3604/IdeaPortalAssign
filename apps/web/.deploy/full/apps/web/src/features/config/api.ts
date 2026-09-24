import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CategoryDefinition, CreateCategoryRequest, UpdateCategoryRequest,
  ExistingSolutionDefinition, CreateExistingSolutionRequest, UpdateExistingSolutionRequest,
  DetectionConfigResponse, UpdateDetectionConfigRequest,
} from "@iep/contracts";
import { api } from "../../app/api-client";
import { invalidateAfter } from "../../app/query-keys";

/**
 * P10 write mutations — categories, the existing-solution capability catalogue, and
 * P12's detection thresholds. Kept apart from `rankings/api.ts`'s `useUpdateProfileWeights`
 * (that one is about a profile's weights specifically): these three are unrelated config
 * surfaces that happen to share this page's write-permission gate, not one feature.
 */

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCategoryRequest) =>
      api<CategoryDefinition>("/config/categories", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      for (const key of invalidateAfter.categoryUpdate()) void qc.invalidateQueries({ queryKey: key });
    },
  });
}

export function useUpdateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ categoryId, ...body }: UpdateCategoryRequest & { categoryId: string }) =>
      api<CategoryDefinition>(`/config/categories/${categoryId}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      for (const key of invalidateAfter.categoryUpdate()) void qc.invalidateQueries({ queryKey: key });
    },
  });
}

export function useCreateExistingSolution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateExistingSolutionRequest) =>
      api<ExistingSolutionDefinition>("/config/existing-solutions", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      for (const key of invalidateAfter.existingSolutionUpdate()) void qc.invalidateQueries({ queryKey: key });
    },
  });
}

export function useUpdateExistingSolution() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ solutionId, ...body }: UpdateExistingSolutionRequest & { solutionId: string }) =>
      api<ExistingSolutionDefinition>(`/config/existing-solutions/${solutionId}`, {
        method: "PATCH", body: JSON.stringify(body),
      }),
    onSuccess: () => {
      for (const key of invalidateAfter.existingSolutionUpdate()) void qc.invalidateQueries({ queryKey: key });
    },
  });
}

export function useUpdateDetectionConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateDetectionConfigRequest) =>
      api<DetectionConfigResponse>("/config/detection", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      for (const key of invalidateAfter.detectionConfigUpdate()) void qc.invalidateQueries({ queryKey: key });
    },
  });
}
