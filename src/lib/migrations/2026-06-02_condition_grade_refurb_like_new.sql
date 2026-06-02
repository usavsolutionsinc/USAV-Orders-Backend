-- ============================================================================
-- 2026-06-02: condition_grade_enum — add LIKE_NEW + REFURBISHED
-- ============================================================================
-- Extends the receiving/inventory condition scale with two new grades so the
-- shared ConditionPills picker (receiving LineEditPanel + shipped
-- ProductDetailsSection) can persist them:
--
--   LIKE_NEW    — opened/inspected, indistinguishable from new.
--   REFURBISHED — repaired/restored to working order.
--
-- Quality ordering surfaced in the UI: New > Like New > Refurbished > Used > Parts.
--
-- condition_grade_enum backs three columns (receiving_lines.condition_grade,
-- serial_units.condition_grade, serial_unit_condition_history.condition_grade),
-- so these additions are global. Purely additive — no existing rows change and
-- no defaults are touched.
--
-- Each ALTER TYPE ADD VALUE must run outside a prior subtransaction; wrap each
-- in DO so replays are idempotent.
-- ============================================================================

BEGIN;

DO $$ BEGIN
  ALTER TYPE condition_grade_enum ADD VALUE IF NOT EXISTS 'LIKE_NEW' AFTER 'BRAND_NEW';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE condition_grade_enum ADD VALUE IF NOT EXISTS 'REFURBISHED' AFTER 'LIKE_NEW';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
