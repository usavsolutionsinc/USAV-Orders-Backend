-- Unit quality score — derived projection (Phase 4).
--
-- Part of the Condition Grading + Repair History QC System
-- (docs/condition-grading-repair-qc-plan.md §4.6 / §5.2). One row per serial
-- unit, recomputed from grade + open failure tags + repair history + sourcing
-- provenance. Compute-and-display only in v1 (no live eBay push).
--
-- Maintained by recomputeUnitQuality() (src/lib/neon/quality-queries.ts), called
-- after grade / failure-tag / repair changes and by GET .../quality (self-heal).
-- It is a cache of pure-function output (src/lib/quality/qualityScore.ts), so it
-- can always be rebuilt by the backfill script — never a source of truth.
--
-- risk_level is plain TEXT with a CHECK (not an enum) to avoid enum churn.

BEGIN;

CREATE TABLE IF NOT EXISTS unit_quality_scores (
  serial_unit_id    INTEGER PRIMARY KEY REFERENCES serial_units(id) ON DELETE CASCADE,
  quality_score     INTEGER NOT NULL,
  risk_level        TEXT NOT NULL DEFAULT 'medium',
  risk_reasons      JSONB NOT NULL DEFAULT '[]'::jsonb,
  ebay_condition_id TEXT,
  grade_at_score    condition_grade_enum,
  computed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE unit_quality_scores
  DROP CONSTRAINT IF EXISTS unit_quality_scores_risk_chk;
ALTER TABLE unit_quality_scores
  ADD CONSTRAINT unit_quality_scores_risk_chk
  CHECK (risk_level IN ('low', 'medium', 'high'));

-- Worklist surfaces (high-risk first, then by score).
CREATE INDEX IF NOT EXISTS idx_unit_quality_risk ON unit_quality_scores (risk_level, quality_score);

COMMIT;
