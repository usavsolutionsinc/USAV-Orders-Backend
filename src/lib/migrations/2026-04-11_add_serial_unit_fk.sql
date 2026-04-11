-- ============================================================================
-- 2026-04-11: Serial Units FK on tech_serial_numbers + sku
-- ============================================================================
-- Additive only. No existing columns removed. Both new columns nullable and
-- stay nullable forever — legacy and batch-imported rows may never resolve to
-- a master serial_units row, and that's fine.
--
-- New write sites stamp this FK after each insert via syncTsnToSerialUnit /
-- syncSkuToSerialUnit. Historical rows get populated by the backfill script.
-- ============================================================================

BEGIN;

ALTER TABLE tech_serial_numbers
  ADD COLUMN IF NOT EXISTS serial_unit_id INTEGER
    REFERENCES serial_units(id) ON DELETE SET NULL;

ALTER TABLE sku
  ADD COLUMN IF NOT EXISTS serial_unit_id INTEGER
    REFERENCES serial_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tech_serial_numbers_serial_unit
  ON tech_serial_numbers (serial_unit_id) WHERE serial_unit_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sku_serial_unit
  ON sku (serial_unit_id) WHERE serial_unit_id IS NOT NULL;

COMMENT ON COLUMN tech_serial_numbers.serial_unit_id IS
  'FK to serial_units master. Nullable for legacy/batch-import rows.';
COMMENT ON COLUMN sku.serial_unit_id IS
  'FK to serial_units master. Nullable for legacy/batch-import rows.';

COMMIT;
