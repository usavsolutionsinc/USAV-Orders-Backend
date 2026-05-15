-- ============================================================================
-- 2026-05-14: Multi-warehouse foundations
-- ============================================================================
-- Adds a `warehouses` registry + `warehouse_id` columns across the inventory
-- chain. Every existing row backfills to the default USAV-MAIN warehouse so
-- nothing breaks today; new endpoints can scope reads/writes by warehouse_id.
--
-- The columns are nullable for now — that lets the migration land without
-- needing to update every existing writer in the same PR. A follow-up migration
-- will mark them NOT NULL once all writers stamp warehouse_id.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS warehouses (
  id            SERIAL PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  timezone      TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  is_default    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed USAV-MAIN as the default. Idempotent.
INSERT INTO warehouses (code, name, timezone, is_default)
VALUES ('USAV-MAIN', 'USAV Main', 'America/Los_Angeles', true)
ON CONFLICT (code) DO UPDATE SET is_default = true;

-- Ensure exactly one warehouse can be marked default.
CREATE UNIQUE INDEX IF NOT EXISTS idx_warehouses_one_default
  ON warehouses((is_default))
  WHERE is_default = true;

-- ─── Stamp warehouse_id on every inventory-scoped table ────────────────────

DO $$
DECLARE
  default_wh INT;
BEGIN
  SELECT id INTO default_wh FROM warehouses WHERE is_default = true LIMIT 1;

  ALTER TABLE locations         ADD COLUMN IF NOT EXISTS warehouse_id INT REFERENCES warehouses(id);
  ALTER TABLE sku_stock         ADD COLUMN IF NOT EXISTS warehouse_id INT REFERENCES warehouses(id);
  ALTER TABLE bin_contents      ADD COLUMN IF NOT EXISTS warehouse_id INT REFERENCES warehouses(id);
  ALTER TABLE sku_stock_ledger  ADD COLUMN IF NOT EXISTS warehouse_id INT REFERENCES warehouses(id);
  ALTER TABLE inventory_events  ADD COLUMN IF NOT EXISTS warehouse_id INT REFERENCES warehouses(id);
  ALTER TABLE staff             ADD COLUMN IF NOT EXISTS default_warehouse_id INT REFERENCES warehouses(id);

  -- Backfill: every existing row goes to USAV-MAIN.
  UPDATE locations         SET warehouse_id = default_wh WHERE warehouse_id IS NULL;
  UPDATE sku_stock         SET warehouse_id = default_wh WHERE warehouse_id IS NULL;
  UPDATE bin_contents      SET warehouse_id = default_wh WHERE warehouse_id IS NULL;
  UPDATE sku_stock_ledger  SET warehouse_id = default_wh WHERE warehouse_id IS NULL;
  UPDATE inventory_events  SET warehouse_id = default_wh WHERE warehouse_id IS NULL;
  UPDATE staff             SET default_warehouse_id = default_wh WHERE default_warehouse_id IS NULL;
END $$;

-- Indices for warehouse-scoped reads.
CREATE INDEX IF NOT EXISTS idx_locations_warehouse        ON locations(warehouse_id)        WHERE warehouse_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sku_stock_warehouse        ON sku_stock(warehouse_id)        WHERE warehouse_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bin_contents_warehouse     ON bin_contents(warehouse_id)     WHERE warehouse_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sku_stock_ledger_warehouse ON sku_stock_ledger(warehouse_id) WHERE warehouse_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventory_events_warehouse ON inventory_events(warehouse_id) WHERE warehouse_id IS NOT NULL;

COMMIT;
