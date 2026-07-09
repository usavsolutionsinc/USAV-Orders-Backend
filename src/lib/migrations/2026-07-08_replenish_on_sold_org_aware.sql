-- ============================================================================
-- 2026-07-08_replenish_on_sold_org_aware.sql
--
-- WHAT: Scope fn_replenish_on_sold() to (organization_id, sku) and stamp
--       organization_id on sourcing_alerts inserts.
--
-- WHY: The pre-tenant trigger joined sku_catalog by bare sku and wrote
--       sourcing_alerts without org scope — cross-tenant SKU string collision
--       would enroll the wrong catalog row or miss the right one.
--
-- SAFETY: CREATE OR REPLACE + exception guard preserved. sourcing_alerts gained
--         organization_id NOT NULL via 2026-06-14_org_id_needs_col_usav_default.
--
-- ROLLBACK: Re-apply fn_replenish_on_sold from 2026-06-06j_sku_replenish.sql.
--
-- VERIFY:
--   INSERT INTO sku_stock_ledger (sku, delta, reason, organization_id)
--   VALUES ('TEST-SKU', -1, 'SOLD', '<org-uuid>');
--   SELECT organization_id FROM sourcing_alerts sa
--     JOIN sku_catalog sc ON sc.id = sa.sku_id
--    WHERE sc.sku = 'TEST-SKU' AND sa.alert_type = 'replenish';
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_replenish_on_sold() RETURNS trigger AS $$
BEGIN
  BEGIN
    INSERT INTO sourcing_alerts (
      sku_id, alert_type, severity, status, reason,
      opened_at, created_at, updated_at, organization_id
    )
    SELECT
      sc.id,
      'replenish',
      'warn',
      'open',
      'Sold/shipped out — needs restock',
      now(),
      now(),
      now(),
      NEW.organization_id
    FROM sku_catalog sc
    WHERE sc.sku = NEW.sku
      AND sc.organization_id = NEW.organization_id
    ON CONFLICT (sku_id, alert_type) WHERE status IN ('open','sourcing')
    DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- Never let replenish enrollment break a sale.
    NULL;
  END;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_replenish_on_sold() IS
  'Auto-enrolls a SKU into a live replenish sourcing_alert when a SOLD ledger row is written (pack-out). Org-scoped via (organization_id, sku). Idempotent + exception-guarded.';

COMMIT;
