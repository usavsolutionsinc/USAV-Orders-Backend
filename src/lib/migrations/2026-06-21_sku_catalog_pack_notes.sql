-- ============================================================================
-- 2026-06-21: pack_notes / notes on sku_catalog
-- ============================================================================
-- Backs the per-SKU "how to pack this product" guidance surfaced to the packer
-- (P1-PCK-02). The packing UI + /api/get-title-by-sku already read a `notes`
-- column on sku_catalog, but the column was never created — so the SELECT was
-- failing at runtime and pack instructions never appeared. This adds it.
--
-- Free-text, nullable, org-owned (sku_catalog already carries organization_id +
-- RLS). Read-only SKU metadata; nothing here touches Zoho quantity/financials.
--
-- Reversible:  ALTER TABLE sku_catalog DROP COLUMN IF EXISTS notes;
-- ============================================================================

BEGIN;

ALTER TABLE sku_catalog ADD COLUMN IF NOT EXISTS notes TEXT;

COMMENT ON COLUMN sku_catalog.notes IS
  'Per-SKU pack/handling guidance shown to the packer before confirm (P1-PCK-02). Read-only metadata; not synced to Zoho.';

COMMIT;
