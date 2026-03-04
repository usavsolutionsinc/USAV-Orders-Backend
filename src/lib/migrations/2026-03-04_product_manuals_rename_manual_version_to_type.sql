-- Migration: rename manual_version to type for multi-document support
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'product_manuals' AND column_name = 'manual_version'
  ) THEN
    EXECUTE 'ALTER TABLE product_manuals RENAME COLUMN manual_version TO type';
  END IF;
END $$;
