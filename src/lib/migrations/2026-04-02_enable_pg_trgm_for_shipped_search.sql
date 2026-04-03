CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_orders_product_title_trgm
  ON orders
  USING gin (lower(product_title) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_sku_trgm
  ON orders
  USING gin (lower(sku) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_tech_serial_numbers_serial_number_trgm
  ON tech_serial_numbers
  USING gin (lower(serial_number) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_shipping_tracking_numbers_tracking_number_raw_trgm
  ON shipping_tracking_numbers
  USING gin (lower(tracking_number_raw) gin_trgm_ops);
