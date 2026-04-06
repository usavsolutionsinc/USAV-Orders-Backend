-- Link tech_serial_numbers rows back to the sku bucket row that supplied them.
-- Used for colon-format tech SKU pulls ("SKU:bin") without changing serial_type semantics.

ALTER TABLE tech_serial_numbers
  ADD COLUMN IF NOT EXISTS source_sku_id INTEGER REFERENCES sku(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tech_serial_numbers_source_sku_id
  ON tech_serial_numbers(source_sku_id)
  WHERE source_sku_id IS NOT NULL;
