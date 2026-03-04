-- Migration: align product_manuals schema to sku/item_number keys
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'product_manuals' AND column_name = 'sku_normalized'
  ) THEN
    EXECUTE 'ALTER TABLE product_manuals RENAME COLUMN sku_normalized TO sku';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'product_manuals' AND column_name = 'item_number_normalized'
  ) THEN
    EXECUTE 'ALTER TABLE product_manuals RENAME COLUMN item_number_normalized TO item_number';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_manuals_active_sku
  ON product_manuals (sku)
  WHERE is_active = TRUE AND sku IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_product_manuals_active_item_number
  ON product_manuals (item_number)
  WHERE is_active = TRUE AND item_number IS NOT NULL;
