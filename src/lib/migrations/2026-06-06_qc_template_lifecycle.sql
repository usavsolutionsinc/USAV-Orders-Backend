-- QC checklist — template lifecycle + structured-value foundation.
--
-- Part of the Condition Grading + Repair History QC System
-- (docs/condition-grading-repair-qc-plan.md, §4.1/§4.2, Phase 1).
--
-- DECISION: QC is advisory, never blocking. There is NO `required` flag and no
-- grade gate. Instead we give checklists a draft→published lifecycle so steps
-- can be authored quietly and "settled" by publishing, plus structured-value
-- columns so battery health / Bluetooth / measurement steps become first-class
-- later without per-product code.
--
-- Two structural changes:
--
--   1. qc_check_templates gains:
--        status      — 'draft' | 'published'. EXECUTION views (tech checklist,
--                      testing-bundle, bulk settle) show only 'published' steps
--                      and count only those toward progress; AUTHORING views
--                      show all and expose a publish toggle. Default 'published'
--                      → ZERO behavior change for every existing step.
--        value_kind  — 'BOOLEAN'|'PERCENT'|'NUMBER'|'ENUM'|'TEXT' (null = legacy
--                      pass/fail). Drives structured capture in a later pass.
--        value_unit  — 'percent'|'V'|'cycles'|… display unit for numeric steps.
--        value_enum  — allowed values when value_kind='ENUM'.
--        pass_min/   — inclusive numeric pass band; lets the SERVER decide
--        pass_max      pass/fail from a recorded number (e.g. battery >= 80).
--
--   2. tech_verifications gains:
--        value_num   — recorded numeric (battery %, voltage).
--        value_text  — recorded enum/text answer.
--
-- failure_modes / unit_failure_tags are intentionally deferred to their own
-- migration (the failure-tag pass) so this file carries no orphan FK.
--
-- status is plain TEXT with a CHECK (not an enum) to avoid enum-ALTER churn;
-- app-level validation gates the writes.

BEGIN;

ALTER TABLE qc_check_templates
  ADD COLUMN IF NOT EXISTS status     TEXT NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS value_kind TEXT,
  ADD COLUMN IF NOT EXISTS value_unit TEXT,
  ADD COLUMN IF NOT EXISTS value_enum JSONB,
  ADD COLUMN IF NOT EXISTS pass_min   NUMERIC,
  ADD COLUMN IF NOT EXISTS pass_max   NUMERIC;

ALTER TABLE qc_check_templates
  DROP CONSTRAINT IF EXISTS qc_check_templates_status_chk;
ALTER TABLE qc_check_templates
  ADD CONSTRAINT qc_check_templates_status_chk
  CHECK (status IN ('draft', 'published'));

ALTER TABLE tech_verifications
  ADD COLUMN IF NOT EXISTS value_num  NUMERIC,
  ADD COLUMN IF NOT EXISTS value_text TEXT;

-- Execution views filter on status — keep that scan cheap.
CREATE INDEX IF NOT EXISTS idx_qc_check_templates_status
  ON qc_check_templates (sku_catalog_id, status);

COMMIT;
