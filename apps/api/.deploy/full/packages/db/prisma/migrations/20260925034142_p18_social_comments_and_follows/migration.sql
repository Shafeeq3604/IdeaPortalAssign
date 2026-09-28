-- CreateTable
CREATE TABLE "idea_comments" (
    "id" UUID NOT NULL,
    "idea_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "mention_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "hidden_at" TIMESTAMPTZ(3),
    "hidden_by_id" UUID,
    "hidden_reason" TEXT,

    CONSTRAINT "idea_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idea_follows" (
    "idea_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idea_follows_pkey" PRIMARY KEY ("idea_id","user_id")
);

-- CreateIndex
CREATE INDEX "idea_comments_idea_id_created_at_idx" ON "idea_comments"("idea_id", "created_at");

-- CreateIndex
CREATE INDEX "idea_follows_user_id_idx" ON "idea_follows"("user_id");

-- AddForeignKey
ALTER TABLE "idea_comments" ADD CONSTRAINT "idea_comments_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_comments" ADD CONSTRAINT "idea_comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_comments" ADD CONSTRAINT "idea_comments_hidden_by_id_fkey" FOREIGN KEY ("hidden_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_follows" ADD CONSTRAINT "idea_follows_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idea_follows" ADD CONSTRAINT "idea_follows_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written (P18). The API enforces these too; the database makes them unstorable.
-- A comment says something: 1-2000 characters, not only whitespace.
ALTER TABLE "idea_comments" ADD CONSTRAINT "ck_idea_comment_body"
  CHECK (char_length("body") BETWEEN 1 AND 2000 AND btrim("body") <> '');
-- Hiding is a moderation decision: who, when and why are recorded together, or not at all.
ALTER TABLE "idea_comments" ADD CONSTRAINT "ck_idea_comment_hidden"
  CHECK (
    ("hidden_at" IS NULL AND "hidden_by_id" IS NULL AND "hidden_reason" IS NULL)
    OR ("hidden_at" IS NOT NULL AND "hidden_by_id" IS NOT NULL AND btrim(coalesce("hidden_reason", '')) <> '')
  );
