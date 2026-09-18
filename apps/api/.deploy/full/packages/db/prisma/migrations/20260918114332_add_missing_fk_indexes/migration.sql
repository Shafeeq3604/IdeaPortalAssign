-- CreateIndex
CREATE INDEX "attachments_idea_version_id_idx" ON "attachments"("idea_version_id");

-- CreateIndex
CREATE INDEX "attachments_uploaded_by_idx" ON "attachments"("uploaded_by");

-- CreateIndex
CREATE INDEX "dependencies_idea_version_id_idx" ON "dependencies"("idea_version_id");

-- CreateIndex
CREATE INDEX "evaluations_profile_id_engine_version_idx" ON "evaluations"("profile_id", "engine_version");

-- CreateIndex
CREATE INDEX "improvement_recommendations_idea_version_id_idx" ON "improvement_recommendations"("idea_version_id");

-- CreateIndex
CREATE INDEX "risks_idea_version_id_idx" ON "risks"("idea_version_id");

-- CreateIndex
CREATE INDEX "score_overrides_criterion_score_id_idx" ON "score_overrides"("criterion_score_id");
