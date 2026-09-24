-- CreateEnum
CREATE TYPE "ExistingSolutionRecommendation" AS ENUM ('BUILD', 'BUY', 'EXTEND', 'INTEGRATE');

-- CreateTable
CREATE TABLE "existing_solution_assessments" (
    "id" UUID NOT NULL,
    "idea_version_id" UUID NOT NULL,
    "recommendation" "ExistingSolutionRecommendation",
    "rationale" TEXT,
    "confidence" "Confidence",
    "source" "ScoreSource" NOT NULL,
    "computed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "existing_solution_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "existing_solution_matches" (
    "id" UUID NOT NULL,
    "assessment_id" UUID NOT NULL,
    "existing_solution_id" UUID NOT NULL,
    "similarity" DECIMAL(5,4) NOT NULL,

    CONSTRAINT "existing_solution_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detection_config" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "similar_idea_threshold" DECIMAL(4,3) NOT NULL DEFAULT 0.85,
    "existing_solution_threshold" DECIMAL(4,3) NOT NULL DEFAULT 0.75,
    "existing_solution_top_n" INTEGER NOT NULL DEFAULT 5,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "detection_config_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "existing_solution_assessments_idea_version_id_key" ON "existing_solution_assessments"("idea_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "existing_solution_matches_assessment_id_existing_solution_i_key" ON "existing_solution_matches"("assessment_id", "existing_solution_id");

-- AddForeignKey
ALTER TABLE "existing_solution_matches" ADD CONSTRAINT "existing_solution_matches_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "existing_solution_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "existing_solution_matches" ADD CONSTRAINT "existing_solution_matches_existing_solution_id_fkey" FOREIGN KEY ("existing_solution_id") REFERENCES "existing_solutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
