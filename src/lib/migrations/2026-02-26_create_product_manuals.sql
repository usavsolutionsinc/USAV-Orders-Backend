-- Migration: create product_manuals table for SKU/item -> manual lookup
CREATE TABLE IF NOT EXISTS product_manuals (
  id BIGSERIAL PRIMARY KEY,
  sku TEXT,
  item_number TEXT,
  google_file_id TEXT NOT NULL,
  type TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_manuals_active_sku
  ON product_manuals (sku)
  WHERE is_active = TRUE AND sku IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_manuals_active_item_number
  ON product_manuals (item_number)
  WHERE is_active = TRUE AND item_number IS NOT NULL;
