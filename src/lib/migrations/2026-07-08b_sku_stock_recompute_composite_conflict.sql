-- ============================================================================
-- 2026-07-08b_sku_stock_recompute_composite_conflict.sql
--
-- WHAT: Flip fn_recompute_sku_stock() ON CONFLICT target to
--       (organization_id, sku) now that sku_stock_org_sku_key exists.
--
-- WHY: Composite unique is the durable multi-tenant key; ON CONFLICT (sku) alone
--       would not upsert the correct org row once global UNIQUE(sku) is dropped.
--
-- SAFETY: Requires 2026-07-08_sku_stock_add_composite_unique.sql applied first.
--         Global UNIQUE(sku) still present — both constraints coexist.
--
-- VERIFY: Ledger INSERT with org_id projects sku_stock row with matching org.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_recompute_sku_stock()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  target_sku  TEXT;
  target_org  UUID;
  warehouse_q INTEGER;
  boxed_q     INTEGER;
BEGIN
  target_sku := COALESCE(NEW.sku, OLD.sku);
  target_org := COALESCE(NEW.organization_id, OLD.organization_id);
  IF target_sku IS NULL OR target_org IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    COALESCE(SUM(CASE WHEN dimension = 'WAREHOUSE' THEN delta ELSE 0 END), 0)::int,
    COALESCE(SUM(CASE WHEN dimension = 'BOXED'     THEN delta ELSE 0 END), 0)::int
  INTO warehouse_q, boxed_q
  FROM sku_stock_ledger
  WHERE sku = target_sku
    AND organization_id = target_org;

  UPDATE sku_stock
  SET stock       = warehouse_q,
      boxed_stock = boxed_q,
      updated_at  = NOW()
  WHERE sku = target_sku
    AND organization_id = target_org;

  IF NOT FOUND THEN
    INSERT INTO sku_stock (sku, stock, boxed_stock, product_title, organization_id)
    VALUES (target_sku, warehouse_q, boxed_q, NULL, target_org)
    ON CONFLICT (organization_id, sku) DO UPDATE
      SET stock       = EXCLUDED.stock,
          boxed_stock = EXCLUDED.boxed_stock,
          updated_at  = NOW();
  END IF;

  RETURN NULL;
END;
$$;

COMMIT;
