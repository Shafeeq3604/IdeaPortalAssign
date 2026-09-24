-- ADR-026 — CHECK constraints Prisma cannot express, same discipline as
-- 00000000000001_spec_constraints (P-7 evidence cardinality, FR-23 rejection reason).

-- P-7: every AI-derived finding must carry evidence. The recommendation is no exception.
ALTER TABLE ai_implementation_recommendations
  ADD CONSTRAINT ck_recommendation_has_evidence CHECK (cardinality(supporting_evidence) > 0),
  ADD CONSTRAINT ck_recommendation_rationale_nonempty CHECK (length(btrim(rationale)) > 0),
  -- Mirrors the RecommendationOutput Zod refine in packages/ai/src/schemas/analysis.ts:
  -- INSUFFICIENT_DATA must say what validation would resolve it, not just assert it.
  ADD CONSTRAINT ck_recommendation_insufficient_data_needs_validation CHECK (
    recommendation <> 'INSUFFICIENT_DATA' OR cardinality(validation_needs) > 0
  );

-- A final organisational decision always states why — same rule reviews already enforce
-- for a REJECTED review (ck_review_rejection_needs_comment), applied unconditionally here
-- since CreateLeadershipDecisionRequest.rationale is required for every status, not just one.
ALTER TABLE leadership_decisions
  ADD CONSTRAINT ck_leadership_decision_rationale_nonempty CHECK (length(btrim(rationale)) > 0);
