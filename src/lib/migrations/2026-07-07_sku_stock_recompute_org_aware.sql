-- ============================================================================
-- 2026-07-07_sku_stock_recompute_org_aware.sql
--
-- WHAT: Make fn_recompute_sku_stock() tenant-aware so sku_stock_ledger INSERTs
--       (e.g. carrier-sync SHIPPED/BOXED drains) project onto sku_stock with a
--       stamped organization_id instead of violating NOT NULL.
--
-- WHY: sku_stock / sku_stock_ledger gained organization_id NOT NULL + loud-fail
--       defaults (2026-05-23, enforced 2026-06-22e) but the trigger from
--       2026-04-15 still aggregated ledger rows by bare `sku` and INSERTed
--       sku_stock without organization_id → production failures:
--       "null value in column organization_id of relation sku_stock".
--
-- SAFETY: Idempotent CREATE OR REPLACE. Single-tenant today (global UNIQUE(sku)
--         on sku_stock remains — composite (organization_id, sku) is a separate
--         expand/contract). Trigger scopes ledger sums and sku_stock writes to
--         COALESCE(NEW.organization_id, OLD.organization_id).
--
-- ROLLBACK: Re-apply the pre-tenant fn_recompute_sku_stock() from
--           2026-04-15_sku_stock_ledger_authoritative.sql (not recommended).
--
-- VERIFY: After apply, a carrier-sync SHIPPED ledger row should succeed:
--   INSERT INTO sku_stock_ledger (sku, delta, reason, dimension, organization_id)
--   VALUES ('TEST-SKU', -1, 'SHIPPED', 'BOXED', '00000000-0000-0000-0000-000000000001');
--   SELECT organization_id FROM sku_stock WHERE sku = 'TEST-SKU';
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

  -- Late-arriving SKU (no sku_stock row yet for this org) — create one.
  IF NOT FOUND THEN
    INSERT INTO sku_stock (sku, stock, boxed_stock, product_title, organization_id)
    VALUES (target_sku, warehouse_q, boxed_q, NULL, target_org)
    ON CONFLICT (sku) DO UPDATE
      SET stock            = EXCLUDED.stock,
          boxed_stock      = EXCLUDED.boxed_stock,
          organization_id  = EXCLUDED.organization_id,
          updated_at       = NOW();
  END IF;

  RETURN NULL;
END;
$$;

COMMIT;
