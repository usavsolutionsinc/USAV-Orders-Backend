-- ============================================================================
-- 2026-05-29: Testing results log (recently-tested feed)
-- ============================================================================
-- A purpose-built, append-only record of every per-unit testing verdict the
-- tech station applies. The authoritative *current* state still lives on
-- serial_units.current_status (TESTED / IN_TEST / ON_HOLD) and the line rollup
-- on receiving_lines; this table is the query-friendly history that powers the
-- "Recently Tested" feed — one row per verdict click.
--
-- Single source of truth: the serial unit is referenced by serial_unit_id ONLY.
-- The serial number, SKU, and condition grade are NOT copied here — every
-- reader JOINs serial_units (the master the receiving pipeline writes to) so
-- the feed never drifts from the canonical unit record.
--
-- Why a dedicated table instead of reusing tech_serial_numbers:
--   tech_serial_numbers is a mixed-purpose serial ledger (receiving capture,
--   FBA/FNSKU, carrier scans). Overloading it for a testing feed forces every
--   reader to filter by station_source and decode scan_ref. A typed table with
--   a created_at DESC index gives a clean, fast "what was tested recently" read
--   without coupling to that ledger's shape.
--
-- Writer:  src/app/api/serial-units/[id]/test/route.ts
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS testing_results (
  id                  BIGSERIAL PRIMARY KEY,
  -- The serial unit under test — the ONLY serial reference. Serial number /
  -- SKU / condition are pulled from serial_units via JOIN, never duplicated.
  serial_unit_id      INTEGER REFERENCES serial_units(id)   ON DELETE SET NULL,
  receiving_line_id   INTEGER REFERENCES receiving_lines(id) ON DELETE SET NULL,
  -- The tech's verdict and the serial_status it mapped to.
  verdict             TEXT NOT NULL
                        CHECK (verdict IN ('PASS', 'TEST_AGAIN', 'TESTING_FAILED')),
  unit_status         TEXT,
  -- Who tested it.
  tested_by           INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  notes               TEXT,
  -- Cross-link to the inventory_events timeline row this verdict produced.
  inventory_event_id  BIGINT REFERENCES inventory_events(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE testing_results IS
  'Append-only log of per-unit testing verdicts (PASS / TEST_AGAIN / TESTING_FAILED) for the Recently Tested feed. References serial_units by id only; serial number / SKU / condition are JOINed from serial_units (single source of truth). Authoritative current state remains on serial_units.current_status.';

-- Primary read pattern: "show me the most recently tested items".
CREATE INDEX IF NOT EXISTS idx_testing_results_recent
  ON testing_results (created_at DESC);

-- "What has this tester worked through?"
CREATE INDEX IF NOT EXISTS idx_testing_results_tester
  ON testing_results (tested_by, created_at DESC);

-- "Testing history for this unit."
CREATE INDEX IF NOT EXISTS idx_testing_results_unit
  ON testing_results (serial_unit_id, created_at DESC);

COMMIT;
