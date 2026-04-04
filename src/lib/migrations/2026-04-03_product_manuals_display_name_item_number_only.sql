-- Migration: add display_name to product_manuals and backfill existing rows
ALTER TABLE product_manuals
  ADD COLUMN IF NOT EXISTS display_name TEXT;

UPDATE product_manuals
SET display_name = COALESCE(
  NULLIF(TRIM(display_name), ''),
  NULLIF(TRIM(product_title), ''),
  CASE
    WHEN NULLIF(TRIM(item_number), '') IS NOT NULL THEN CONCAT(TRIM(item_number), ' Manual')
    ELSE 'Product Manual'
  END
)
WHERE display_name IS NULL OR TRIM(display_name) = '';
