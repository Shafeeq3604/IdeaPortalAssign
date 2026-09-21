-- CreateEnum
CREATE TYPE "MarketDimension" AS ENUM ('MARKET_NEED', 'MARKET_OPPORTUNITY', 'COMPETITIVE_LANDSCAPE', 'COMPETITIVE_ADVANTAGE', 'COMMERCIAL_VIABILITY');

-- AlterEnum
ALTER TYPE "AnalysisStep" ADD VALUE 'MARKET_CONTEXT';

-- CreateTable
CREATE TABLE "market_findings" (
    "id" UUID NOT NULL,
    "ai_analysis_id" UUID NOT NULL,
    "dimension" "MarketDimension" NOT NULL,
    "band" "Band" NOT NULL,
    "rationale" TEXT NOT NULL,
    "evidence" TEXT[],

    CONSTRAINT "market_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "market_findings_ai_analysis_id_dimension_key" ON "market_findings"("ai_analysis_id", "dimension");

-- AddForeignKey
ALTER TABLE "market_findings" ADD CONSTRAINT "market_findings_ai_analysis_id_fkey" FOREIGN KEY ("ai_analysis_id") REFERENCES "ai_analyses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
