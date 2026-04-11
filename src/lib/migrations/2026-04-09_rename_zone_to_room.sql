-- ============================================================================
-- 2026-04-09: Rename zone → room in locations + FK bin_contents → sku_catalog
-- ============================================================================

BEGIN;

-- 1. Rename zone column to room
ALTER TABLE locations RENAME COLUMN zone TO room;

-- 2. Rebuild index with new column name
DROP INDEX IF EXISTS idx_locations_row_col;
CREATE INDEX idx_locations_room_row_col ON locations (room, row_label, col_label);

-- 3. Add FK on bin_contents.sku → sku_catalog.sku
-- Only add if not already present; skip rows with SKUs not yet in catalog
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_bin_contents_sku'
      AND table_name = 'bin_contents'
  ) THEN
    -- Remove any orphan bin_contents rows whose SKU isn't in sku_catalog
    DELETE FROM bin_contents
    WHERE sku NOT IN (SELECT sku FROM sku_catalog);

    ALTER TABLE bin_contents
      ADD CONSTRAINT fk_bin_contents_sku
      FOREIGN KEY (sku) REFERENCES sku_catalog(sku)
      ON UPDATE CASCADE ON DELETE RESTRICT;
  END IF;
END $$;

COMMIT;
