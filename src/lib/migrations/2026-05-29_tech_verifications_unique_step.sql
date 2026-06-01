-- ============================================================================
-- 2026-05-29: tech_verifications — one verification per (source, step)
-- ============================================================================
-- tech_verifications is the per-step execution log for the QC checklist
-- (qc_check_templates). upsertVerification() in sku-catalog-queries.ts already
-- expects "insert, else update the existing row for this step", but the table
-- shipped without a unique constraint — so its `ON CONFLICT DO NOTHING` never
-- conflicts and every re-mark inserts a DUPLICATE instead of updating.
--
-- This adds the missing uniqueness so a tester toggling a step (or re-marking
-- it) updates the single row for that (source_kind, source_row_id, step_type,
-- step_id) tuple. The table is currently unwired (no callers), so the dedup
-- below is purely defensive.
-- ============================================================================

BEGIN;

-- Collapse any accidental duplicates, keeping the most recent row per step.
DELETE FROM tech_verifications a
USING tech_verifications b
WHERE a.id < b.id
  AND a.source_kind   = b.source_kind
  AND a.source_row_id = b.source_row_id
  AND a.step_type     = b.step_type
  AND a.step_id       = b.step_id;

CREATE UNIQUE INDEX IF NOT EXISTS ux_tech_verifications_step
  ON tech_verifications (source_kind, source_row_id, step_type, step_id);

COMMIT;
