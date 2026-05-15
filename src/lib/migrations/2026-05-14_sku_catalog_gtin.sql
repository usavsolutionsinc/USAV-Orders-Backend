-- ============================================================================
-- 2026-05-14: GTIN on sku_catalog
-- ============================================================================
-- Adds the Global Trade Item Number to every catalog row so we can emit
-- GS1 Digital Link QRs (Sunrise 2027) alongside the existing URL form.
-- Nullable — only SKUs that ship to big-box retailers need GTINs.
-- ============================================================================

BEGIN;

ALTER TABLE sku_catalog ADD COLUMN IF NOT EXISTS gtin TEXT;

-- GTINs are 8/12/13/14 digits; constrain at the application level rather
-- than the DB so we don't reject legacy / non-numeric variants.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sku_catalog_gtin
  ON sku_catalog(gtin)
  WHERE gtin IS NOT NULL AND gtin <> '';

COMMENT ON COLUMN sku_catalog.gtin IS 'GS1 Global Trade Item Number — used to encode Digital Link QRs (/01/{gtin}).';

COMMIT;
