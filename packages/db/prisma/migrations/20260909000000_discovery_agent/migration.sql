-- SPC-001 — AI Discovery Agent (standalone research tool).
--
-- Deliberately has no foreign key to ideas, idea_versions, evaluations,
-- criterion_scores, or ranking_entries — a discovery query can never create, modify, or
-- link one (SPC-13). Only "user_id" ties it to anything, and only for history scoping.

-- CreateEnum
CREATE TYPE "DiscoveryStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "discovery_queries" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "query" TEXT NOT NULL,
    "status" "DiscoveryStatus" NOT NULL DEFAULT 'PENDING',
    "discovery_type" TEXT,
    "summary" TEXT,
    "items" JSONB,
    "provider" TEXT,
    "model" TEXT,
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "discovery_queries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discovery_queries_user_id_created_at_idx" ON "discovery_queries"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "discovery_queries" ADD CONSTRAINT "discovery_queries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
