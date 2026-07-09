-- ─────────────────────────────────────────────────────────────────────────────
-- sku_stock: phase 1 (EXPAND) — add UNIQUE(organization_id, sku) ALONGSIDE the
-- existing global UNIQUE(sku). NON-BREAKING and safe to apply anytime.
-- ─────────────────────────────────────────────────────────────────────────────
-- Why two phases: app upserts can flip to ON CONFLICT (organization_id, sku)
-- once this composite constraint exists, while legacy ON CONFLICT (sku) keeps
-- working until the gated contract drops the global unique.
--
-- Safe on current data: organization_id is NOT NULL and single-tenant today,
-- so (organization_id, sku) is already unique.
--
-- Apply order: run this BEFORE deploying ON CONFLICT (organization_id, sku) code.
-- Then deploy code + 2026-07-08b_sku_stock_recompute_composite_conflict.sql.
-- Drop global UNIQUE(sku) via 2026-07-08_sku_stock_composite_unique.sql.gated
-- only when tenant #2 is ready.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'sku_stock'::regclass AND conname = 'sku_stock_org_sku_key'
  ) THEN
    ALTER TABLE sku_stock
      ADD CONSTRAINT sku_stock_org_sku_key UNIQUE (organization_id, sku);
  END IF;
END $$;
