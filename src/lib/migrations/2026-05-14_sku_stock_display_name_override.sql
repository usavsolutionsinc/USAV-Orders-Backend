-- ============================================================================
-- 2026-05-14: sku_stock.display_name_override
-- ============================================================================
-- Lets the bin editor capture a short, human-friendly product title that
-- takes priority over the Ecwid display_name and sku_catalog.product_title.
--
-- Why: most stock SKUs do not yet have an Ecwid pairing (only ~7% paired),
-- and the catalog title is often the long manufacturer string. Receivers
-- need a fast way to give a SKU a short label without waiting for Ecwid sync.
-- ============================================================================

BEGIN;

ALTER TABLE sku_stock
  ADD COLUMN IF NOT EXISTS display_name_override TEXT;

COMMENT ON COLUMN sku_stock.display_name_override IS
  'Optional short product label set by a staff member from the bin editor. '
  'Wins over Ecwid display_name + sku_catalog.product_title in lookups.';

COMMIT;
