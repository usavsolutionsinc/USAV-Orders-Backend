-- Extend receiving_lines to carry full line-level lifecycle state.
-- This is the core of the inbound workflow normalization.
--
-- Lifecycle:  EXPECTED → ARRIVED → MATCHED → UNBOXED → AWAITING_TEST
--             → IN_TEST → PASSED | FAILED → RTV | SCRAP | DONE

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inbound_workflow_status_enum') THEN
    CREATE TYPE inbound_workflow_status_enum AS ENUM (
      'EXPECTED',
      'ARRIVED',
      'MATCHED',
      'UNBOXED',
      'AWAITING_TEST',
      'IN_TEST',
      'PASSED',
      'FAILED',
      'RTV',
      'SCRAP',
      'DONE'
    );
  END IF;
END $$;

ALTER TABLE receiving_lines
  ADD COLUMN IF NOT EXISTS workflow_status   inbound_workflow_status_enum NOT NULL DEFAULT 'EXPECTED',
  ADD COLUMN IF NOT EXISTS needs_test        BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS assigned_tech_id  INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disposition_final TEXT,
  ADD COLUMN IF NOT EXISTS created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Index for fast tech queue lookups
CREATE INDEX IF NOT EXISTS idx_receiving_lines_workflow_status
  ON receiving_lines(workflow_status);

CREATE INDEX IF NOT EXISTS idx_receiving_lines_assigned_tech
  ON receiving_lines(assigned_tech_id)
  WHERE assigned_tech_id IS NOT NULL;

-- Auto-maintain updated_at
CREATE OR REPLACE FUNCTION fn_set_receiving_lines_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_receiving_lines_updated_at ON receiving_lines;
CREATE TRIGGER trg_receiving_lines_updated_at
  BEFORE UPDATE ON receiving_lines
  FOR EACH ROW EXECUTE FUNCTION fn_set_receiving_lines_updated_at();
