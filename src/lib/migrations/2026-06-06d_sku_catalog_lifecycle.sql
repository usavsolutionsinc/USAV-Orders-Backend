-- ============================================================================
-- 2026-06-06: sku_catalog lifecycle + sourcing columns (Bose Sourcing Engine P0)
-- ============================================================================
-- Adds the lifecycle signal that drives sourcing alerts. A SKU that is EOL or
-- discontinued and at/below its reorder threshold is what the nightly sourcing
-- scan turns into a sourcing_alert. last_known_cost_cents is a rolling cost
-- stamped from part_acquisitions on import so margin views have a baseline.
--
-- Additive only. Default 'active' keeps every existing row behaving exactly as
-- before (the lifecycle index is partial so it stays empty until a SKU is
-- actually flagged). See docs/bose-parts-sourcing-engine-plan.md §3.1.
-- ============================================================================

BEGIN;

ALTER TABLE sku_catalog
  ADD COLUMN IF NOT EXISTS lifecycle_status      text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS reorder_threshold     integer,
  ADD COLUMN IF NOT EXISTS last_known_cost_cents integer,
  ADD COLUMN IF NOT EXISTS sourcing_notes        text;

-- active|eol|discontinued|nrnd (not-recommended-for-new-design)|unknown
ALTER TABLE sku_catalog
  DROP CONSTRAINT IF EXISTS sku_catalog_lifecycle_chk;
ALTER TABLE sku_catalog
  ADD CONSTRAINT sku_catalog_lifecycle_chk
  CHECK (lifecycle_status IN ('active','eol','discontinued','nrnd','unknown'));

-- Partial: only non-active rows matter to the sourcing scan, so the index stays
-- tiny and the common 'active' case never touches it.
CREATE INDEX IF NOT EXISTS idx_sku_catalog_lifecycle
  ON sku_catalog (lifecycle_status)
  WHERE lifecycle_status <> 'active';

COMMENT ON COLUMN sku_catalog.lifecycle_status IS
  'Sourcing lifecycle: active|eol|discontinued|nrnd|unknown. Non-active rows feed runSourcingScanJob.';
COMMENT ON COLUMN sku_catalog.reorder_threshold IS
  'Min on-hand before the sourcing scan opens a low_stock alert (NULL = no threshold).';
COMMENT ON COLUMN sku_catalog.last_known_cost_cents IS
  'Rolling acquisition cost stamped from part_acquisitions on import; baseline for margin.';

COMMIT;
