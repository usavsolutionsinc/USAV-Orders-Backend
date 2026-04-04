-- Migration: extend product_manuals for folder-based manual storage and CRUD metadata

ALTER TABLE product_manuals
  ALTER COLUMN google_file_id DROP NOT NULL;

ALTER TABLE product_manuals
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS relative_path TEXT,
  ADD COLUMN IF NOT EXISTS folder_path TEXT,
  ADD COLUMN IF NOT EXISTS file_name TEXT,
  ADD COLUMN IF NOT EXISTS status TEXT,
  ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS assigned_by TEXT;

UPDATE product_manuals
SET status = CASE
  WHEN COALESCE(is_active, TRUE) = TRUE THEN 'assigned'
  ELSE 'archived'
END
WHERE status IS NULL OR TRIM(status) = '';

UPDATE product_manuals
SET folder_path = CONCAT('assigned/', TRIM(item_number))
WHERE (folder_path IS NULL OR TRIM(folder_path) = '')
  AND item_number IS NOT NULL
  AND TRIM(item_number) <> ''
  AND status = 'assigned';

UPDATE product_manuals
SET file_name = NULLIF(regexp_replace(relative_path, '^.*/', ''), '')
WHERE (file_name IS NULL OR TRIM(file_name) = '')
  AND relative_path IS NOT NULL
  AND TRIM(relative_path) <> '';

ALTER TABLE product_manuals
  ALTER COLUMN status SET DEFAULT 'assigned';

ALTER TABLE product_manuals
  ALTER COLUMN status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'product_manuals_status_check'
  ) THEN
    ALTER TABLE product_manuals
      ADD CONSTRAINT product_manuals_status_check
      CHECK (status IN ('unassigned', 'assigned', 'archived'));
  END IF;
END $$;

DROP INDEX IF EXISTS ux_product_manuals_active_sku;
DROP INDEX IF EXISTS ux_product_manuals_active_item_number;

CREATE INDEX IF NOT EXISTS idx_product_manuals_active_sku
  ON product_manuals (sku)
  WHERE is_active = TRUE AND sku IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_manuals_active_item_number
  ON product_manuals (item_number)
  WHERE is_active = TRUE AND item_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_manuals_status
  ON product_manuals (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_manuals_relative_path
  ON product_manuals (relative_path)
  WHERE relative_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_manuals_product_title
  ON product_manuals (product_title);

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_manuals_active_relative_path
  ON product_manuals (relative_path)
  WHERE is_active = TRUE AND relative_path IS NOT NULL;
