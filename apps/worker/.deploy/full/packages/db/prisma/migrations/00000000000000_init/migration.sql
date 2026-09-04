-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('EMPLOYEE', 'REVIEWER', 'ADMIN', 'MANAGEMENT');

-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'AI_ANALYSIS', 'NEEDS_CLARIFICATION', 'EVALUATED', 'RANKED', 'UNDER_REVIEW', 'PROTOTYPE_CANDIDATE', 'PILOT', 'PRODUCTION_CANDIDATE', 'IMPLEMENTED', 'PARKED', 'BLOCKED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AnalysisStep" AS ENUM ('STRUCTURE', 'USE_CASES', 'VALUE', 'FEASIBILITY', 'RISK', 'EFFORT_TIMELINE', 'IMPROVEMENT', 'EXPLANATION');

-- CreateEnum
CREATE TYPE "AnalysisStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "Band" AS ENUM ('NEGLIGIBLE', 'LOW', 'MODERATE', 'HIGH', 'VERY_HIGH');

-- CreateEnum
CREATE TYPE "Confidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ScoreSource" AS ENUM ('AI', 'HUMAN', 'SIGNAL', 'FALLBACK');

-- CreateEnum
CREATE TYPE "UseCaseKind" AS ENUM ('DIRECT', 'INDIRECT');

-- CreateEnum
CREATE TYPE "Horizon" AS ENUM ('SHORT', 'MEDIUM', 'LONG');

-- CreateEnum
CREATE TYPE "UserCountBand" AS ENUM ('LT10', 'B10_100', 'B100_1K', 'B1K_10K', 'GT10K');

-- CreateEnum
CREATE TYPE "FeasibilityStatus" AS ENUM ('HIGHLY_FEASIBLE', 'FEASIBLE_WITH_CONDITIONS', 'REQUIRES_INVESTIGATION', 'NOT_CURRENTLY_FEASIBLE');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "EffortClass" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH');

-- CreateEnum
CREATE TYPE "TimelinePhase" AS ENUM ('DISCOVERY', 'PROTOTYPE', 'MVP', 'TESTING', 'DEPLOYMENT');

-- CreateEnum
CREATE TYPE "RequirementKind" AS ENUM ('PEOPLE', 'TECHNOLOGY', 'DATA', 'ORG');

-- CreateEnum
CREATE TYPE "DependencyKind" AS ENUM ('INTERNAL', 'EXTERNAL', 'VENDOR', 'DATA');

-- CreateEnum
CREATE TYPE "CriterionGroup" AS ENUM ('VALUE', 'FEASIBILITY', 'EFFORT', 'STRATEGIC', 'RISK', 'DEMAND');

-- CreateEnum
CREATE TYPE "CriterionDirection" AS ENUM ('HIGHER_IS_BETTER', 'LOWER_IS_BETTER');

-- CreateEnum
CREATE TYPE "CriterionSourceKind" AS ENUM ('AI_FACTOR', 'SIGNAL', 'HUMAN');

-- CreateEnum
CREATE TYPE "ExplanationSource" AS ENUM ('ENGINE', 'ENGINE_PLUS_AI_NARRATIVE');

-- CreateEnum
CREATE TYPE "RankingEffect" AS ENUM ('LIKELY_UP', 'POSSIBLY_UP', 'NEUTRAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "RecommendationState" AS ENUM ('OPEN', 'ADDRESSED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('VALIDATED', 'NEEDS_CLARIFICATION', 'OVERRIDDEN', 'APPROVED_FOR_PROTOTYPE', 'REJECTED', 'PARKED');

-- CreateEnum
CREATE TYPE "ModelTier" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "ThinkingMode" AS ENUM ('ADAPTIVE', 'BUDGETED', 'NONE');

-- CreateEnum
CREATE TYPE "ValueDimension" AS ENUM ('BUSINESS_IMPACT', 'PRODUCTIVITY', 'COST_REDUCTION', 'REVENUE', 'EMPLOYEE_EXPERIENCE', 'CUSTOMER_IMPACT', 'OPERATIONAL', 'PROBLEM_SEVERITY', 'PROBLEM_FREQUENCY');

-- CreateEnum
CREATE TYPE "FeasibilityDimension" AS ENUM ('TECHNICAL', 'DATA', 'INFRASTRUCTURE', 'INTEGRATION', 'SECURITY', 'PRIVACY', 'COMPLIANCE', 'EXPERTISE', 'RESOURCES', 'COST', 'EXTERNAL_DEPENDENCY');

-- CreateEnum
CREATE TYPE "RiskCategory" AS ENUM ('TECHNICAL', 'SECURITY', 'PRIVACY', 'COMPLIANCE', 'FINANCIAL', 'OPERATIONAL', 'ADOPTION', 'DATA', 'VENDOR');

-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('WOULD_USE', 'HAVE_PROBLEM', 'SIMILAR_USE_CASE', 'CAN_PROVIDE_DATA', 'CAN_HELP_IMPLEMENT', 'SEE_RISK', 'HAVE_IMPROVEMENT');

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "external_subject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "department_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "user_id" UUID NOT NULL,
    "role" "Role" NOT NULL,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id","role")
);

-- CreateTable
CREATE TABLE "idea_categories" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idea_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ideas" (
    "id" UUID NOT NULL,
    "submitter_id" UUID NOT NULL,
    "department_id" UUID,
    "category_id" UUID,
    "status" "IdeaStatus" NOT NULL DEFAULT 'DRAFT',
    "maturity_level" INTEGER,
    "current_version_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ideas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_versions" (
    "id" UUID NOT NULL,
    "idea_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "problem_statement" TEXT NOT NULL,
    "expected_users" TEXT NOT NULL,
    "expected_outcome" TEXT NOT NULL,
    "existing_process" TEXT,
    "existing_solutions" TEXT,
    "suggested_technology" TEXT,
    "expected_benefits" TEXT,
    "estimated_cost_note" TEXT,
    "references" TEXT,
    "change_summary" TEXT,
    "author_id" UUID NOT NULL,
    "content_hash" TEXT NOT NULL,
    "embedding" vector(1536),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idea_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "idea_version_id" UUID NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "storage_key" TEXT NOT NULL,
    "uploaded_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_analyses" (
    "id" UUID NOT NULL,
    "idea_version_id" UUID NOT NULL,
    "step" "AnalysisStep" NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tier" "ModelTier" NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "cached_input_tokens" INTEGER,
    "cost_usd_micros" INTEGER,
    "redaction_applied" BOOLEAN NOT NULL DEFAULT false,
    "escalated_from_tier" "ModelTier",
    "raw_payload" JSONB,
    "error_code" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_structured_proposals" (
    "id" UUID NOT NULL,
    "ai_analysis_id" UUID NOT NULL,
    "problem_statement" TEXT NOT NULL,
    "proposed_solution" TEXT NOT NULL,
    "target_users" TEXT NOT NULL,
    "assumptions" TEXT[],
    "missing_information" TEXT[],
    "clarification_questions" TEXT[],

    CONSTRAINT "ai_structured_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "use_cases" (
    "id" UUID NOT NULL,
    "ai_analysis_id" UUID NOT NULL,
    "kind" "UseCaseKind" NOT NULL,
    "horizon" "Horizon" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "department_scope" TEXT[],
    "estimated_user_count_band" "UserCountBand" NOT NULL,
    "is_speculative" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "use_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "value_findings" (
    "id" UUID NOT NULL,
    "ai_analysis_id" UUID NOT NULL,
    "dimension" "ValueDimension" NOT NULL,
    "band" "Band" NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidence" TEXT[],

    CONSTRAINT "value_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feasibility_assessments" (
    "id" UUID NOT NULL,
    "idea_version_id" UUID NOT NULL,
    "status" "FeasibilityStatus" NOT NULL,
    "summary" TEXT NOT NULL,
    "constraint_citations" TEXT[],

    CONSTRAINT "feasibility_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feasibility_findings" (
    "id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "dimension" "FeasibilityDimension" NOT NULL,
    "band" "Band" NOT NULL,
    "finding" TEXT NOT NULL,
    "condition" TEXT,

    CONSTRAINT "feasibility_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risks" (
    "id" UUID NOT NULL,
    "idea_version_id" UUID NOT NULL,
    "category" "RiskCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "level" "RiskLevel" NOT NULL,
    "potential_impact" TEXT NOT NULL,
    "mitigation" TEXT NOT NULL,

    CONSTRAINT "risks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dependencies" (
    "id" UUID NOT NULL,
    "idea_version_id" UUID NOT NULL,
    "kind" "DependencyKind" NOT NULL,
    "description" TEXT NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "implementation_plans" (
    "id" UUID NOT NULL,
    "idea_version_id" UUID NOT NULL,
    "effort_class" "EffortClass" NOT NULL,
    "cost_class" "EffortClass" NOT NULL,
    "operational_complexity" "EffortClass" NOT NULL,
    "notes" TEXT,

    CONSTRAINT "implementation_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "implementation_requirements" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "kind" "RequirementKind" NOT NULL,
    "item" TEXT NOT NULL,
    "detail" TEXT,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "implementation_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "timeline_estimates" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "phase" "TimelinePhase" NOT NULL,
    "min_weeks" INTEGER NOT NULL,
    "max_weeks" INTEGER NOT NULL,
    "is_preliminary" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "timeline_estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_criteria" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "group" "CriterionGroup" NOT NULL,
    "direction" "CriterionDirection" NOT NULL,
    "scale_min" INTEGER NOT NULL DEFAULT 0,
    "scale_max" INTEGER NOT NULL DEFAULT 100,
    "source_kind" "CriterionSourceKind" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "evaluation_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_profiles" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "evaluation_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_weights" (
    "profile_id" UUID NOT NULL,
    "criterion_id" UUID NOT NULL,
    "weight" DECIMAL(5,4) NOT NULL,

    CONSTRAINT "profile_weights_pkey" PRIMARY KEY ("profile_id","criterion_id")
);

-- CreateTable
CREATE TABLE "ai_model_routes" (
    "story_key" TEXT NOT NULL,
    "tier" "ModelTier" NOT NULL,
    "model_id" TEXT NOT NULL,
    "effort" TEXT,
    "thinking_mode" "ThinkingMode" NOT NULL,
    "thinking_budget_tokens" INTEGER,
    "max_tokens" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_model_routes_pkey" PRIMARY KEY ("story_key")
);

-- CreateTable
CREATE TABLE "evaluations" (
    "id" UUID NOT NULL,
    "idea_version_id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "engine_version" TEXT NOT NULL,
    "composite_score" DECIMAL(6,3) NOT NULL,
    "maturity_level" INTEGER NOT NULL,
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "criterion_scores" (
    "id" UUID NOT NULL,
    "evaluation_id" UUID NOT NULL,
    "criterion_id" UUID NOT NULL,
    "raw_band" "Band",
    "normalized" DECIMAL(6,3) NOT NULL,
    "weight" DECIMAL(5,4) NOT NULL,
    "contribution" DECIMAL(6,3) NOT NULL,
    "source" "ScoreSource" NOT NULL,
    "confidence" "Confidence" NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidence" TEXT[],

    CONSTRAINT "criterion_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_overrides" (
    "id" UUID NOT NULL,
    "criterion_score_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "previous_normalized" DECIMAL(6,3) NOT NULL,
    "new_normalized" DECIMAL(6,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ranking_runs" (
    "id" UUID NOT NULL,
    "profile_id" UUID NOT NULL,
    "cohort_key" JSONB NOT NULL,
    "engine_version" TEXT NOT NULL,
    "triggered_by" UUID,
    "trigger_reason" TEXT NOT NULL,
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ranking_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ranking_entries" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "idea_id" UUID NOT NULL,
    "evaluation_id" UUID NOT NULL,
    "rank" INTEGER NOT NULL,
    "composite_score" DECIMAL(6,3) NOT NULL,
    "percentile" DECIMAL(5,2) NOT NULL,
    "previous_rank" INTEGER,

    CONSTRAINT "ranking_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ranking_explanations" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "strengths" JSONB NOT NULL,
    "constraints" JSONB NOT NULL,
    "peer_comparisons" JSONB NOT NULL,
    "generated_by" "ExplanationSource" NOT NULL,

    CONSTRAINT "ranking_explanations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "improvement_recommendations" (
    "id" UUID NOT NULL,
    "idea_version_id" UUID NOT NULL,
    "issue" TEXT NOT NULL,
    "why_it_matters" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,
    "how_to_implement" TEXT NOT NULL,
    "expected_effect" TEXT NOT NULL,
    "projected_ranking_effect" "RankingEffect" NOT NULL,
    "target_criterion_id" UUID,
    "priority" INTEGER NOT NULL,
    "status" "RecommendationState" NOT NULL DEFAULT 'OPEN',
    "resolved_in_version_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "improvement_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "idea_id" UUID NOT NULL,
    "reviewer_id" UUID NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "status_history" (
    "id" UUID NOT NULL,
    "idea_id" UUID NOT NULL,
    "from_status" "IdeaStatus",
    "to_status" "IdeaStatus" NOT NULL,
    "actor_id" UUID NOT NULL,
    "reason" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "request_id" TEXT,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" UUID NOT NULL,
    "idea_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "FeedbackType" NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demand_signals" (
    "id" UUID NOT NULL,
    "idea_id" UUID NOT NULL,
    "signal_key" TEXT NOT NULL,
    "value" DECIMAL(10,3) NOT NULL,
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demand_signals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "similar_ideas" (
    "id" UUID NOT NULL,
    "idea_id" UUID NOT NULL,
    "similar_to" UUID NOT NULL,
    "similarity" DECIMAL(5,4) NOT NULL,
    "difference_summary" TEXT,

    CONSTRAINT "similar_ideas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "existing_solutions" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "owner_department_id" UUID,
    "categories" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "embedding" vector(1536),

    CONSTRAINT "existing_solutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "entity_id" UUID,
    "payload" JSONB,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_definitions" (
    "id" UUID NOT NULL,
    "idea_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "target_value" DECIMAL(14,3),
    "predicted_value" DECIMAL(14,3),

    CONSTRAINT "kpi_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_measurements" (
    "id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "actual_value" DECIMAL(14,3) NOT NULL,
    "measured_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "kpi_measurements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pilot_records" (
    "id" UUID NOT NULL,
    "idea_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "outcome" TEXT,

    CONSTRAINT "pilot_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_name_key" ON "departments"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_external_subject_key" ON "users"("external_subject");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "idea_categories_key_key" ON "idea_categories"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ideas_current_version_id_key" ON "ideas"("current_version_id");

-- CreateIndex
CREATE INDEX "ideas_status_department_id_idx" ON "ideas"("status", "department_id");

-- CreateIndex
CREATE INDEX "ideas_submitter_id_created_at_idx" ON "ideas"("submitter_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idea_versions_content_hash_idx" ON "idea_versions"("content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "idea_versions_idea_id_version_no_key" ON "idea_versions"("idea_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "ai_analyses_idea_version_id_step_key" ON "ai_analyses"("idea_version_id", "step");

-- CreateIndex
CREATE UNIQUE INDEX "ai_structured_proposals_ai_analysis_id_key" ON "ai_structured_proposals"("ai_analysis_id");

-- CreateIndex
CREATE UNIQUE INDEX "value_findings_ai_analysis_id_dimension_key" ON "value_findings"("ai_analysis_id", "dimension");

-- CreateIndex
CREATE UNIQUE INDEX "feasibility_assessments_idea_version_id_key" ON "feasibility_assessments"("idea_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "feasibility_findings_assessment_id_dimension_key" ON "feasibility_findings"("assessment_id", "dimension");

-- CreateIndex
CREATE UNIQUE INDEX "implementation_plans_idea_version_id_key" ON "implementation_plans"("idea_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "timeline_estimates_plan_id_phase_key" ON "timeline_estimates"("plan_id", "phase");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_criteria_key_key" ON "evaluation_criteria"("key");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_profiles_key_key" ON "evaluation_profiles"("key");

-- CreateIndex
CREATE UNIQUE INDEX "evaluations_idea_version_id_profile_id_engine_version_key" ON "evaluations"("idea_version_id", "profile_id", "engine_version");

-- CreateIndex
CREATE UNIQUE INDEX "criterion_scores_evaluation_id_criterion_id_key" ON "criterion_scores"("evaluation_id", "criterion_id");

-- CreateIndex
CREATE INDEX "ranking_runs_profile_id_computed_at_idx" ON "ranking_runs"("profile_id", "computed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ranking_entries_run_id_idea_id_key" ON "ranking_entries"("run_id", "idea_id");

-- CreateIndex
CREATE UNIQUE INDEX "ranking_entries_run_id_rank_key" ON "ranking_entries"("run_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "ranking_explanations_entry_id_key" ON "ranking_explanations"("entry_id");

-- CreateIndex
CREATE INDEX "reviews_idea_id_created_at_idx" ON "reviews"("idea_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "status_history_idea_id_at_idx" ON "status_history"("idea_id", "at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_at_idx" ON "audit_log"("entity_type", "entity_id", "at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_actor_id_at_idx" ON "audit_log"("actor_id", "at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "feedback_idea_id_user_id_type_key" ON "feedback"("idea_id", "user_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "demand_signals_idea_id_signal_key_key" ON "demand_signals"("idea_id", "signal_key");

-- CreateIndex
CREATE UNIQUE INDEX "similar_ideas_idea_id_similar_to_key" ON "similar_ideas"("idea_id", "similar_to");

-- CreateIndex
CREATE UNIQUE INDEX "existing_solutions_name_key" ON "existing_solutions"("name");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_created_at_idx" ON "notifications"("user_id", "read_at", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "pilot_records_idea_id_key" ON "pilot_records"("idea_id");

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_submitter_id_fkey" FOREIGN KEY ("submitter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "idea_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "idea_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_versions" ADD CONSTRAINT "idea_versions_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_versions" ADD CONSTRAINT "idea_versions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_idea_version_id_fkey" FOREIGN KEY ("idea_version_id") REFERENCES "idea_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_idea_version_id_fkey" FOREIGN KEY ("idea_version_id") REFERENCES "idea_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_structured_proposals" ADD CONSTRAINT "ai_structured_proposals_ai_analysis_id_fkey" FOREIGN KEY ("ai_analysis_id") REFERENCES "ai_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "use_cases" ADD CONSTRAINT "use_cases_ai_analysis_id_fkey" FOREIGN KEY ("ai_analysis_id") REFERENCES "ai_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "value_findings" ADD CONSTRAINT "value_findings_ai_analysis_id_fkey" FOREIGN KEY ("ai_analysis_id") REFERENCES "ai_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feasibility_assessments" ADD CONSTRAINT "feasibility_assessments_idea_version_id_fkey" FOREIGN KEY ("idea_version_id") REFERENCES "idea_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feasibility_findings" ADD CONSTRAINT "feasibility_findings_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "feasibility_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risks" ADD CONSTRAINT "risks_idea_version_id_fkey" FOREIGN KEY ("idea_version_id") REFERENCES "idea_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dependencies" ADD CONSTRAINT "dependencies_idea_version_id_fkey" FOREIGN KEY ("idea_version_id") REFERENCES "idea_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "implementation_plans" ADD CONSTRAINT "implementation_plans_idea_version_id_fkey" FOREIGN KEY ("idea_version_id") REFERENCES "idea_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "implementation_requirements" ADD CONSTRAINT "implementation_requirements_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "implementation_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "timeline_estimates" ADD CONSTRAINT "timeline_estimates_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "implementation_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_weights" ADD CONSTRAINT "profile_weights_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "evaluation_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_weights" ADD CONSTRAINT "profile_weights_criterion_id_fkey" FOREIGN KEY ("criterion_id") REFERENCES "evaluation_criteria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_idea_version_id_fkey" FOREIGN KEY ("idea_version_id") REFERENCES "idea_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "evaluation_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "criterion_scores" ADD CONSTRAINT "criterion_scores_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "criterion_scores" ADD CONSTRAINT "criterion_scores_criterion_id_fkey" FOREIGN KEY ("criterion_id") REFERENCES "evaluation_criteria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_overrides" ADD CONSTRAINT "score_overrides_criterion_score_id_fkey" FOREIGN KEY ("criterion_score_id") REFERENCES "criterion_scores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_overrides" ADD CONSTRAINT "score_overrides_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranking_runs" ADD CONSTRAINT "ranking_runs_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "evaluation_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranking_entries" ADD CONSTRAINT "ranking_entries_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "ranking_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranking_entries" ADD CONSTRAINT "ranking_entries_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranking_entries" ADD CONSTRAINT "ranking_entries_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ranking_explanations" ADD CONSTRAINT "ranking_explanations_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "ranking_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_recommendations" ADD CONSTRAINT "improvement_recommendations_idea_version_id_fkey" FOREIGN KEY ("idea_version_id") REFERENCES "idea_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_recommendations" ADD CONSTRAINT "improvement_recommendations_target_criterion_id_fkey" FOREIGN KEY ("target_criterion_id") REFERENCES "evaluation_criteria"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "improvement_recommendations" ADD CONSTRAINT "improvement_recommendations_resolved_in_version_id_fkey" FOREIGN KEY ("resolved_in_version_id") REFERENCES "idea_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_id_fkey" FOREIGN KEY ("reviewer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "status_history" ADD CONSTRAINT "status_history_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_measurements" ADD CONSTRAINT "kpi_measurements_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "kpi_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

