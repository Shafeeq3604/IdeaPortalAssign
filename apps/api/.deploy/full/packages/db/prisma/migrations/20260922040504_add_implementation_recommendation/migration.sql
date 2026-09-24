-- CreateEnum
CREATE TYPE "ImplementationRecommendationAction" AS ENUM ('RECOMMEND', 'RECOMMEND_WITH_CONDITIONS', 'DO_NOT_RECOMMEND', 'INSUFFICIENT_DATA');

-- CreateEnum
CREATE TYPE "LeadershipDecisionStatus" AS ENUM ('APPROVED', 'REJECTED', 'NEEDS_VALIDATION', 'OVERRIDE_RECOMMENDATION');

-- AlterEnum
ALTER TYPE "AnalysisStep" ADD VALUE 'IMPLEMENTATION_RECOMMENDATION';

-- CreateTable
CREATE TABLE "ai_implementation_recommendations" (
    "id" UUID NOT NULL,
    "idea_version_id" UUID NOT NULL,
    "recommendation" "ImplementationRecommendationAction" NOT NULL,
    "rationale" TEXT NOT NULL,
    "supporting_evidence" TEXT[],
    "risks" TEXT[],
    "assumptions" TEXT[],
    "validation_needs" TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_implementation_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leadership_decisions" (
    "id" UUID NOT NULL,
    "idea_id" UUID NOT NULL,
    "recommendation_id" UUID NOT NULL,
    "decided_by" UUID NOT NULL,
    "status" "LeadershipDecisionStatus" NOT NULL,
    "rationale" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leadership_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_implementation_recommendations_idea_version_id_key" ON "ai_implementation_recommendations"("idea_version_id");

-- CreateIndex
CREATE INDEX "leadership_decisions_idea_id_created_at_idx" ON "leadership_decisions"("idea_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "ai_implementation_recommendations" ADD CONSTRAINT "ai_implementation_recommendations_idea_version_id_fkey" FOREIGN KEY ("idea_version_id") REFERENCES "idea_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leadership_decisions" ADD CONSTRAINT "leadership_decisions_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leadership_decisions" ADD CONSTRAINT "leadership_decisions_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "ai_implementation_recommendations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leadership_decisions" ADD CONSTRAINT "leadership_decisions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
