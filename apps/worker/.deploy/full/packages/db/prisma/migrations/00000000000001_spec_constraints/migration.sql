-- IEP — load-bearing constraints (SPEC §5, §17.4).
-- Each encodes a REQUIREMENT, not a preference. Every one has a test in
-- packages/db/test/constraints.test.ts. An untested constraint is an unenforced requirement.
--
-- Run after `prisma migrate dev` generates the base tables.

-- ── FR-06 — feasibility may not make an absolute claim without cited constraints ──
ALTER TABLE feasibility_assessments
  ADD CONSTRAINT ck_feasibility_absolute_needs_citation
  CHECK (
    status <> 'NOT_CURRENTLY_FEASIBLE'
    OR cardinality(constraint_citations) > 0
  );

-- ── FR-08 — an AI timeline estimate is always preliminary; the false value is unstorable ──
ALTER TABLE timeline_estimates
  ADD CONSTRAINT ck_timeline_is_preliminary CHECK (is_preliminary),
  ADD CONSTRAINT ck_timeline_range CHECK (min_weeks > 0 AND max_weeks >= min_weeks);

-- ── FR-10 — every risk carries a recommended mitigation (NOT NULL is in the schema;
--            this rejects the whitespace-only evasion) ──
ALTER TABLE risks
  ADD CONSTRAINT ck_risk_mitigation_nonempty CHECK (length(btrim(mitigation)) > 0);

-- ── FR-15 — the six-part recommendation cannot be partially satisfied ──
ALTER TABLE improvement_recommendations
  ADD CONSTRAINT ck_recommendation_six_parts CHECK (
    length(btrim(issue))            > 0 AND
    length(btrim(why_it_matters))   > 0 AND
    length(btrim(recommendation))   > 0 AND
    length(btrim(how_to_implement)) > 0 AND
    length(btrim(expected_effect))  > 0
  ),
  ADD CONSTRAINT ck_recommendation_priority CHECK (priority BETWEEN 1 AND 3);

-- ── FR-23 — "Rejected with Reason" ──
ALTER TABLE reviews
  ADD CONSTRAINT ck_review_rejection_needs_comment
  CHECK (decision <> 'REJECTED' OR length(btrim(coalesce(comment, ''))) > 0);

-- ── P-7 — evidence-driven: no scored criterion and no value finding without evidence ──
ALTER TABLE criterion_scores
  ADD CONSTRAINT ck_criterion_score_has_evidence CHECK (cardinality(evidence) > 0),
  ADD CONSTRAINT ck_criterion_score_range CHECK (normalized BETWEEN 0 AND 100),
  ADD CONSTRAINT ck_criterion_weight_range CHECK (weight >= 0 AND weight <= 1);

ALTER TABLE value_findings
  ADD CONSTRAINT ck_value_finding_has_evidence CHECK (cardinality(evidence) > 0);

-- ── P-2 — no unexplained number: an entry cannot exist without a real explanation ──
ALTER TABLE ranking_explanations
  ADD CONSTRAINT ck_explanation_nonempty CHECK (
    jsonb_array_length(strengths)   > 0 AND
    jsonb_array_length(constraints) > 0
  );

ALTER TABLE ranking_entries
  ADD CONSTRAINT ck_rank_positive CHECK (rank > 0),
  ADD CONSTRAINT ck_percentile_range CHECK (percentile BETWEEN 0 AND 100);

-- ── SPEC §4.2 — a reviewer may not decide on their own idea (privilege escalation guard) ──
CREATE OR REPLACE FUNCTION assert_reviewer_is_not_submitter() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM ideas i WHERE i.id = NEW.idea_id AND i.submitter_id = NEW.reviewer_id) THEN
    RAISE EXCEPTION 'reviewer_id must differ from idea.submitter_id (SPEC 4.2)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_review_not_own_idea
  BEFORE INSERT OR UPDATE ON reviews
  FOR EACH ROW EXECUTE FUNCTION assert_reviewer_is_not_submitter();

CREATE OR REPLACE FUNCTION assert_override_not_own_idea() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM criterion_scores cs
    JOIN evaluations e   ON e.id  = cs.evaluation_id
    JOIN idea_versions iv ON iv.id = e.idea_version_id
    JOIN ideas i         ON i.id  = iv.idea_id
    WHERE cs.id = NEW.criterion_score_id AND i.submitter_id = NEW.reviewer_id
  ) THEN
    RAISE EXCEPTION 'a reviewer may not override a score on their own idea (SPEC 4.2)'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_override_not_own_idea
  BEFORE INSERT ON score_overrides
  FOR EACH ROW EXECUTE FUNCTION assert_override_not_own_idea();

-- ── FR-13 — an active profile's weights always sum to 1.0000 (±0.0001).
--            DEFERRED so a multi-row rebalance can commit atomically, but never persist unbalanced. ──
CREATE OR REPLACE FUNCTION assert_profile_weights_sum_to_one() RETURNS trigger AS $$
DECLARE
  bad RECORD;
BEGIN
  FOR bad IN
    SELECT p.key, COALESCE(SUM(w.weight), 0) AS total
    FROM evaluation_profiles p
    LEFT JOIN profile_weights w ON w.profile_id = p.id
    WHERE p.is_active
    GROUP BY p.id, p.key
    HAVING ABS(COALESCE(SUM(w.weight), 0) - 1.0) > 0.0001
  LOOP
    RAISE EXCEPTION 'active profile "%" weights sum to %, expected 1.0000 (SPEC FR-13)',
      bad.key, bad.total USING ERRCODE = 'check_violation';
  END LOOP;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER trg_profile_weights_balanced
  AFTER INSERT OR UPDATE OR DELETE ON profile_weights
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_profile_weights_sum_to_one();

-- ── FR-24 — v1 has no change summary; every later version must have one ──
ALTER TABLE idea_versions
  ADD CONSTRAINT ck_version_change_summary CHECK (
    (version_no = 1 AND change_summary IS NULL)
    OR (version_no > 1 AND length(btrim(coalesce(change_summary, ''))) > 0)
  ),
  ADD CONSTRAINT ck_version_no_positive CHECK (version_no > 0),
  ADD CONSTRAINT ck_title_length CHECK (length(title) BETWEEN 1 AND 200),
  ADD CONSTRAINT ck_description_length CHECK (length(description) BETWEEN 1 AND 20000);

-- ── SPEC §4.7 — audit_log is append-only for the application role ──
CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only (SPEC 4.7)' USING ERRCODE = 'insufficient_privilege';
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_audit_append_only
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

-- Belt and braces: the grant-level control. Applied by the ops role, not the app role.
--   REVOKE UPDATE, DELETE ON audit_log FROM iep_app;
