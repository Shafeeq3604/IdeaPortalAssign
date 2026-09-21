-- AlterTable
ALTER TABLE "idea_creation_conversations" ADD COLUMN     "ready_to_review" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "suggested_replies" TEXT[] DEFAULT ARRAY[]::TEXT[];
