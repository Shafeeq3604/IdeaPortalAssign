-- CreateIndex
CREATE INDEX "feedback_user_id_created_at_idx" ON "feedback"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "reviews_reviewer_id_created_at_idx" ON "reviews"("reviewer_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "leadership_decisions_decided_by_created_at_idx" ON "leadership_decisions"("decided_by", "created_at" DESC);
