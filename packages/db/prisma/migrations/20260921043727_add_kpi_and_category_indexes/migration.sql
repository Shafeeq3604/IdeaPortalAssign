-- CreateIndex
CREATE INDEX "ideas_category_id_idx" ON "ideas"("category_id");

-- CreateIndex
CREATE INDEX "kpi_definitions_idea_id_idx" ON "kpi_definitions"("idea_id");
