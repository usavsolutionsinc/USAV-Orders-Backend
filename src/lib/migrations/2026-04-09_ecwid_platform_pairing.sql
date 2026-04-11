-- ============================================================================
-- 2026-04-09: Enable unpaired Ecwid products in sku_platform_ids
-- ============================================================================
-- Make sku_catalog_id nullable so Ecwid products can be stored before
-- being manually paired to a Zoho SKU.
-- Reactivate all Zoho SKUs (Zoho = SoT for inventory).
-- ============================================================================

BEGIN;

-- Allow NULL sku_catalog_id for unpaired platform entries
ALTER TABLE sku_platform_ids
  ALTER COLUMN sku_catalog_id DROP NOT NULL;

-- Reactivate all Zoho SKUs
UPDATE sku_catalog SET is_active = true, updated_at = NOW() WHERE is_active = false;

-- Add display_name and image_url to sku_platform_ids for Ecwid product info
ALTER TABLE sku_platform_ids ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE sku_platform_ids ADD COLUMN IF NOT EXISTS image_url TEXT;

COMMIT;
