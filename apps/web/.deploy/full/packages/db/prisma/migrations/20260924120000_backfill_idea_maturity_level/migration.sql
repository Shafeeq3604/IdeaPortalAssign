-- Data-only backfill. `ideas.maturity_level` was declared (SPEC §5.3) but never written, so
-- every idea header read "Maturity —". Evaluation now keeps it in step; this fills the
-- ideas scored before that, from their current version's latest evaluation.
UPDATE "ideas" AS i
SET "maturity_level" = latest."maturity_level"
FROM (
  SELECT DISTINCT ON ("idea_version_id") "idea_version_id", "maturity_level"
  FROM "evaluations"
  ORDER BY "idea_version_id", "computed_at" DESC
) AS latest
WHERE latest."idea_version_id" = i."current_version_id"
  AND i."maturity_level" IS DISTINCT FROM latest."maturity_level";
