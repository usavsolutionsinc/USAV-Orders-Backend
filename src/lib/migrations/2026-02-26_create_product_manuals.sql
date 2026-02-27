-- Migration: create product_manuals table for SKU/item -> manual lookup
CREATE TABLE IF NOT EXISTS product_manuals (
  id BIGSERIAL PRIMARY KEY,
  sku_normalized TEXT,
  item_number_normalized TEXT,
  google_file_id TEXT NOT NULL,
  manual_version TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_manuals_active_sku
  ON product_manuals (sku_normalized)
  WHERE is_active = TRUE AND sku_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_manuals_active_item_number
  ON product_manuals (item_number_normalized)
  WHERE is_active = TRUE AND item_number_normalized IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_manuals_active_sku
  ON product_manuals (sku_normalized)
  WHERE is_active = TRUE AND sku_normalized IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_manuals_active_item_number
  ON product_manuals (item_number_normalized)
  WHERE is_active = TRUE AND item_number_normalized IS NOT NULL;
