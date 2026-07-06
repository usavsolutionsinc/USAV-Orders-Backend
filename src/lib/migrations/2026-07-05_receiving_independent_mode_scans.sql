-- ============================================================================
-- Receiving triage / unbox mode independence (2026-07-05)
-- ============================================================================
-- Triage (door) and Unbox (bench) scans are separate operator surfaces. A scan
-- on Unbox must not stamp received_at/received_by (the triage door event).
-- unbox_only_intake flags cartons first touched on Unbox without a prior triage
-- door scan. condition_set_at records when an operator explicitly picked a
-- condition grade (server truth for the progress stepper).
-- ============================================================================

BEGIN;

ALTER TABLE receiving_scans
  ADD COLUMN IF NOT EXISTS intake_surface TEXT;

ALTER TABLE receiving_scans
  DROP CONSTRAINT IF EXISTS receiving_scans_intake_surface_chk;
ALTER TABLE receiving_scans
  ADD CONSTRAINT receiving_scans_intake_surface_chk
  CHECK (intake_surface IS NULL OR intake_surface IN ('triage', 'unbox'));

ALTER TABLE receiving
  ADD COLUMN IF NOT EXISTS unbox_only_intake BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE receiving_lines
  ADD COLUMN IF NOT EXISTS condition_set_at TIMESTAMPTZ;

COMMENT ON COLUMN receiving_scans.intake_surface IS
  'Which operator surface recorded this scan: triage (door) or unbox (bench). NULL on legacy rows.';
COMMENT ON COLUMN receiving.unbox_only_intake IS
  'True when the carton was first opened via an Unbox-surface scan with no prior triage door scan (received_at still NULL).';
COMMENT ON COLUMN receiving_lines.condition_set_at IS
  'When the operator explicitly selected condition_grade (distinct from the DB default).';

CREATE INDEX IF NOT EXISTS idx_receiving_unbox_only_intake
  ON receiving(organization_id, unbox_opened_at DESC NULLS LAST)
  WHERE unbox_only_intake = true;

COMMIT;
