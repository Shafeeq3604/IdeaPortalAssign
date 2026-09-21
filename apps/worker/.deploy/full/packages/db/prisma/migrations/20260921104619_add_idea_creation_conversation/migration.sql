-- CreateEnum
CREATE TYPE "IdeaCreationStatus" AS ENUM ('ACTIVE', 'AWAITING_AI', 'HANDED_OFF');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'AI');

-- CreateTable
CREATE TABLE "idea_creation_conversations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "IdeaCreationStatus" NOT NULL DEFAULT 'ACTIVE',
    "turn_count" INTEGER NOT NULL DEFAULT 0,
    "draft" JSONB NOT NULL,
    "provider" TEXT,
    "error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "idea_creation_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_creation_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "draft_after" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idea_creation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idea_creation_conversations_user_id_updated_at_idx" ON "idea_creation_conversations"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "idea_creation_messages_conversation_id_created_at_idx" ON "idea_creation_messages"("conversation_id", "created_at");

-- AddForeignKey
ALTER TABLE "idea_creation_conversations" ADD CONSTRAINT "idea_creation_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_creation_messages" ADD CONSTRAINT "idea_creation_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "idea_creation_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
