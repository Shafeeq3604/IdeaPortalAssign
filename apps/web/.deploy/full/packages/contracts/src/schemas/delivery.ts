import { z } from "zod";
import { ActorRef, Id, Timestamp } from "./common.js";
import { CriterionDirection, IdeaStatus } from "../enums.js";

/**
 * Delivery tracking — P15 (prototype & pilot tracking) and P16 (KPIs, actual-vs-
 * predicted, ROI), one "Delivery" tab per idea.
 *
 * Every number on this tab is ENTERED BY A PERSON (a reviewer or admin — the people who
 * move ideas through these stages) or is plain arithmetic on such entries. Nothing here
 * is estimated by AI, and none of it feeds the composite score (P-5). The KPI count and
 * the pilot's existence were already P0 inputs to the engine's MATURITY factor
 * (packages/evaluation/src/factors.ts), which is unchanged.
 */

/** The stages in which delivery details may be recorded. */
export const DELIVERY_STAGES = ["PROTOTYPE_CANDIDATE", "PILOT", "PRODUCTION_CANDIDATE", "IMPLEMENTED"] as const;

/** A person's judgement of how the pilot went — never computed. */
export const PilotOutcome = z.enum(["SUCCEEDED", "MIXED", "DID_NOT_SUCCEED"]);
export type PilotOutcome = z.infer<typeof PilotOutcome>;

const Amount = z.number().finite().min(0).max(999_999_999_999.99);
const KpiValue = z.number().finite().min(-99_999_999_999.999).max(99_999_999_999.999);

export const PilotRecordView = z.object({
  startedAt: Timestamp.nullable(),
  endedAt: Timestamp.nullable(),
  scope: z.string().nullable(),
  outcome: PilotOutcome.nullable(),
  outcomeNotes: z.string().nullable(),
  updatedBy: ActorRef.nullable(),
  updatedAt: Timestamp,
});
export type PilotRecordView = z.infer<typeof PilotRecordView>;

export const DeliveryUpdateView = z.object({
  id: Id,
  stage: IdeaStatus,
  note: z.string(),
  author: ActorRef,
  createdAt: Timestamp,
});
export type DeliveryUpdateView = z.infer<typeof DeliveryUpdateView>;

export const KpiMeasurementView = z.object({
  id: Id,
  actualValue: z.number(),
  measuredAt: Timestamp,
  note: z.string().nullable(),
  recordedBy: ActorRef.nullable(),
});
export type KpiMeasurementView = z.infer<typeof KpiMeasurementView>;

/**
 * Actual vs predicted, for the LATEST measurement. `difference` = actual − predicted.
 * `percent` is relative to the prediction and null when the prediction is 0 (undefined,
 * not infinite). `standing` applies the KPI's direction to the sign of the difference —
 * wording only; an exact tie is ON_PREDICTION, no tolerance band is invented.
 */
export const KpiVersusPredicted = z.object({
  difference: z.number(),
  percent: z.number().nullable(),
  standing: z.enum(["AHEAD", "ON_PREDICTION", "BEHIND"]),
});
export type KpiVersusPredicted = z.infer<typeof KpiVersusPredicted>;

export const KpiView = z.object({
  id: Id,
  name: z.string(),
  unit: z.string(),
  description: z.string().nullable(),
  direction: CriterionDirection,
  targetValue: z.number().nullable(),
  predictedValue: z.number().nullable(),
  /** Oldest first — the order a chart reads. */
  measurements: z.array(KpiMeasurementView),
  /** Null until there is both a prediction and at least one measurement. */
  versusPredicted: KpiVersusPredicted.nullable(),
  createdAt: Timestamp,
});
export type KpiView = z.infer<typeof KpiView>;

export const FinancialsView = z.object({
  currency: z.string().length(3),
  investmentToDate: z.number().nullable(),
  realizedBenefit: z.number().nullable(),
  basisNote: z.string().nullable(),
  /**
   * (benefit − investment) / investment, as a ratio (0.25 = 25%). Null unless both are
   * entered and the investment is above zero — never a guess.
   */
  roi: z.number().nullable(),
  updatedBy: ActorRef.nullable(),
  updatedAt: Timestamp,
});
export type FinancialsView = z.infer<typeof FinancialsView>;

export const IdeaDeliveryResponse = z.object({
  ideaId: Id,
  status: IdeaStatus,
  /** Server decides (D-09): the actor may record delivery details AND the idea is in a delivery stage. */
  canWrite: z.boolean(),
  /** True once the idea has reached a delivery stage — the tab is empty and explains why before that. */
  inDeliveryStage: z.boolean(),
  pilot: PilotRecordView.nullable(),
  updates: z.array(DeliveryUpdateView),
  kpis: z.array(KpiView),
  financials: FinancialsView.nullable(),
});
export type IdeaDeliveryResponse = z.infer<typeof IdeaDeliveryResponse>;

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const AddDeliveryUpdateRequest = z.object({ note: trimmed(4_000) });
export type AddDeliveryUpdateRequest = z.infer<typeof AddDeliveryUpdateRequest>;

export const UpdatePilotRequest = z
  .object({
    scope: optionalText(2_000),
    outcome: PilotOutcome.nullable().optional(),
    outcomeNotes: optionalText(4_000),
    startedAt: Timestamp.nullable().optional(),
    endedAt: Timestamp.nullable().optional(),
  })
  .refine(
    (v) => !v.startedAt || !v.endedAt || new Date(v.endedAt) >= new Date(v.startedAt),
    { path: ["endedAt"], message: "The pilot cannot end before it started" },
  );
export type UpdatePilotRequest = z.infer<typeof UpdatePilotRequest>;

export const CreateKpiRequest = z.object({
  name: trimmed(120),
  unit: trimmed(40),
  description: optionalText(1_000),
  direction: CriterionDirection.default("HIGHER_IS_BETTER"),
  targetValue: KpiValue.nullable().optional(),
  predictedValue: KpiValue.nullable().optional(),
});
export type CreateKpiRequest = z.infer<typeof CreateKpiRequest>;

export const UpdateKpiRequest = z.object({
  name: trimmed(120).optional(),
  unit: trimmed(40).optional(),
  description: optionalText(1_000),
  direction: CriterionDirection.optional(),
  targetValue: KpiValue.nullable().optional(),
  predictedValue: KpiValue.nullable().optional(),
});
export type UpdateKpiRequest = z.infer<typeof UpdateKpiRequest>;

export const AddKpiMeasurementRequest = z.object({
  actualValue: KpiValue,
  /** Must not be in the future — a measurement records something that happened. */
  measuredAt: Timestamp.refine((t) => new Date(t).getTime() <= Date.now() + 60_000, "A measurement cannot be dated in the future"),
  note: optionalText(1_000),
});
export type AddKpiMeasurementRequest = z.infer<typeof AddKpiMeasurementRequest>;

export const UpdateFinancialsRequest = z.object({
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, "Use a three-letter currency code, e.g. USD"),
  investmentToDate: Amount.nullable().optional(),
  realizedBenefit: Amount.nullable().optional(),
  basisNote: optionalText(500),
});
export type UpdateFinancialsRequest = z.infer<typeof UpdateFinancialsRequest>;
