import { z } from "zod";
import {
  Band, DependencyKind, EffortClass, FeasibilityDimension, FeasibilityStatus, Horizon,
  RankingEffect, RiskCategory, RiskLevel, TimelinePhase, UseCaseKind, UserCountBand,
  ValueDimension, RequirementKind,
} from "@iep/contracts";

/**
 * AI output schemas, AI-01..AI-08 (SPEC §14 P0.6, §12).
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  ADR-005 — THE INVARIANT THIS FILE EXISTS TO ENFORCE
 *  NO SCHEMA HERE MAY CONTAIN A NUMERIC SCORE, RANK, WEIGHT, OR PERCENTAGE.
 *  The model emits ordinal bands and evidence. The engine emits numbers.
 *  tests/arch/no-ai-scores.test.ts walks every schema in this file and fails the
 *  build on a z.number() outside the tiny allow-list below.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Allowed numerics, and why each is not a score:
 *   - timeline min/max weeks  → a duration, stored is_preliminary, display-only in M1 (D-11)
 *   - priority 1..3           → an ordinal bucket on a recommendation, not a magnitude
 * Everything else is an enum.
 */

/** Every band the model asserts must carry evidence. P-7, enforced again at the DB. */
const evidence = z.array(z.string().min(3).max(500)).min(1).max(6);
const shortText = z.string().min(3).max(400);
const longText = z.string().min(3).max(2000);

// ───────────────────────────── AI-01 · STRUCTURE (Tier B) ─────────────────────────────

export const StructureOutput = z
  .object({
    problemStatement: longText,
    proposedSolution: longText,
    targetUsers: shortText,
    assumptions: z.array(shortText).max(10),
    missingInformation: z.array(shortText).max(10),
    clarificationQuestions: z.array(shortText).max(5),
  })
  .strict();
export type StructureOutput = z.infer<typeof StructureOutput>;

// ───────────────────────────── AI-02 · USE CASES (Tier B) ─────────────────────────────

export const UseCaseOutput = z
  .object({
    useCases: z
      .array(
        z
          .object({
            kind: UseCaseKind,
            horizon: Horizon,
            title: z.string().min(3).max(160),
            description: shortText,
            departmentScope: z.array(z.string().max(80)).max(8),
            estimatedUserCountBand: UserCountBand,
            /** FR-04: realistic now vs. potential future must be distinguishable. */
            isSpeculative: z.boolean(),
            evidence,
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict();
export type UseCaseOutput = z.infer<typeof UseCaseOutput>;

// ───────────────────────────── AI-03 · VALUE (Tier A) ─────────────────────────────

export const ValueOutput = z
  .object({
    findings: z
      .array(
        z.object({ dimension: ValueDimension, band: Band, rationale: shortText, evidence }).strict(),
      )
      .length(9), // all nine dimensions of FR-05, every time
  })
  .strict()
  .refine(
    (v) => new Set(v.findings.map((f) => f.dimension)).size === 9,
    { message: "each of the 9 value dimensions must appear exactly once" },
  );
export type ValueOutput = z.infer<typeof ValueOutput>;

// ───────────────────────────── AI-04 · FEASIBILITY (Tier A) ─────────────────────────────

export const FeasibilityOutput = z
  .object({
    status: FeasibilityStatus,
    summary: longText,
    /**
     * FR-06: an absolute claim requires explicit organisational constraints.
     * Enforced here, in the semantic validator, AND as a DB CHECK. Three layers,
     * because this is the one verdict that can kill a good idea.
     */
    constraintCitations: z.array(shortText).max(10),
    findings: z
      .array(
        z
          .object({
            dimension: FeasibilityDimension,
            band: Band,
            finding: shortText,
            /** What would make it feasible. Improvement over rejection (P-4). */
            condition: shortText.nullable(),
            evidence,
          })
          .strict(),
      )
      .min(1)
      .max(11),
  })
  .strict()
  .refine(
    (v) => v.status !== "NOT_CURRENTLY_FEASIBLE" || v.constraintCitations.length > 0,
    {
      path: ["constraintCitations"],
      message:
        "NOT_CURRENTLY_FEASIBLE requires at least one explicit organisational constraint (FR-06)",
    },
  );
export type FeasibilityOutput = z.infer<typeof FeasibilityOutput>;

// ───────────────────────────── AI-05 · RISK (Tier A) ─────────────────────────────

export const RiskOutput = z
  .object({
    risks: z
      .array(
        z
          .object({
            category: RiskCategory,
            description: shortText,
            level: RiskLevel,
            potentialImpact: shortText,
            /** FR-10: never optional. */
            mitigation: shortText,
            evidence,
          })
          .strict(),
      )
      .min(1)
      .max(15),
    dependencies: z
      .array(
        z.object({ kind: DependencyKind, description: shortText, blocking: z.boolean() }).strict(),
      )
      .max(15),
  })
  .strict();
export type RiskOutput = z.infer<typeof RiskOutput>;

// ──────────────────── AI-06 + AI-07 · EFFORT, REQUIREMENTS, TIMELINE (Tier B) ────────────────────
// One call, two schema sections — saves a round-trip (SPEC §12.3).

export const EffortTimelineOutput = z
  .object({
    effortClass: EffortClass,
    costClass: EffortClass,
    operationalComplexity: EffortClass,
    notes: shortText.nullable(),
    requirements: z
      .array(
        z
          .object({
            kind: RequirementKind,
            item: z.string().min(2).max(160),
            detail: shortText.nullable(),
            isMandatory: z.boolean(),
          })
          .strict(),
      )
      .max(40),
    timeline: z
      .array(
        z
          .object({
            phase: TimelinePhase,
            // ALLOWED numeric: a duration, not a score. Always stored is_preliminary (D-11).
            minWeeks: z.number().int().min(1).max(104),
            maxWeeks: z.number().int().min(1).max(104),
          })
          .strict()
          .refine((t) => t.maxWeeks >= t.minWeeks, { message: "maxWeeks must be >= minWeeks" }),
      )
      .length(5),
    evidence,
  })
  .strict()
  .refine((v) => new Set(v.timeline.map((t) => t.phase)).size === 5, {
    message: "all five timeline phases must appear exactly once",
  });
export type EffortTimelineOutput = z.infer<typeof EffortTimelineOutput>;

// ───────────────────────────── AI-08 · IMPROVEMENT (Tier A) ─────────────────────────────
// Input is the engine's CONTRIBUTION VECTOR, not the raw idea: the model explains what
// the deterministic engine already found weak (SPEC §12.3).

export const ImprovementOutput = z
  .object({
    recommendations: z
      .array(
        z
          .object({
            // All six parts of FR-15. None optional — the structure cannot be half-met.
            issue: shortText,
            whyItMatters: shortText,
            recommendation: shortText,
            howToImplement: longText,
            expectedEffect: shortText,
            projectedRankingEffect: RankingEffect,
            targetCriterionKey: z.string().max(64).nullable(),
            // ALLOWED numeric: an ordinal bucket, not a magnitude.
            priority: z.number().int().min(1).max(3),
          })
          .strict(),
      )
      .max(8), // may legitimately be empty for a strong idea (D-13, SPEC §9.6)
  })
  .strict();
export type ImprovementOutput = z.infer<typeof ImprovementOutput>;

// ───────────────────────────── AI-09 · NARRATIVE (Tier B, OPTIONAL) ─────────────────────────────
// Rewrites the engine's explanation into fluent prose. It may not add claims; the
// semantic validator rejects any criterion key the engine did not supply.

export const NarrativeOutput = z
  .object({
    summary: longText,
    strengthsProse: z.array(shortText).max(5),
    constraintsProse: z.array(shortText).max(5),
    /** Echoed back so the validator can prove no claim was invented. */
    citedCriterionKeys: z.array(z.string().max(64)).max(20),
  })
  .strict();
export type NarrativeOutput = z.infer<typeof NarrativeOutput>;

export const AI_OUTPUT_SCHEMAS = {
  STRUCTURE: StructureOutput,
  USE_CASES: UseCaseOutput,
  VALUE: ValueOutput,
  FEASIBILITY: FeasibilityOutput,
  RISK: RiskOutput,
  EFFORT_TIMELINE: EffortTimelineOutput,
  IMPROVEMENT: ImprovementOutput,
  EXPLANATION: NarrativeOutput,
} as const;
