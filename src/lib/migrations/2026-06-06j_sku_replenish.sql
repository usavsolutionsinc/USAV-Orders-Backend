-- ============================================================================
-- 2026-06-06: Auto-replenish on pack-out (Bose Sourcing Engine)
-- ============================================================================
-- "Whenever the packer scans an item out of the warehouse, that SKU lands on a
-- clearable replenish record; then alert when it can be re-sourced below the
-- per-SKU price point you set."
--
-- Mechanism (no app-code change to the critical pack path):
--   1. `sku_catalog.replenish_target_cents` — the per-SKU target price you set.
--   2. A trigger on `sku_stock_ledger` fires for every `reason='SOLD'` row (the
--      single inventory-decrement event written by /api/pack/ship and any other
--      sale path) and upserts one live `sourcing_alerts` row of type 'replenish'
--      for that SKU. Idempotent (the uniq_sourcing_alert_live partial index),
--      and wrapped so it can NEVER raise — a replenish enrollment must not be
--      able to fail a shipment.
--   3. The replenish watcher cron (/api/cron/sourcing/replenish) searches eBay
--      for SKUs that have a live replenish alert + a target price, and escalates
--      the alert (→ critical) + saves candidates when a listing lands at/below
--      the target. The record is cleared from the Sourcing → Alerts pane (or
--      auto-resolves when restocked by the existing scan job).
-- ============================================================================

BEGIN;

-- 1. Per-SKU target price.
ALTER TABLE sku_catalog
  ADD COLUMN IF NOT EXISTS replenish_target_cents integer;
COMMENT ON COLUMN sku_catalog.replenish_target_cents IS
  'Replenish price point (cents). The watcher alerts when a listing lands at/below this.';

-- 2. Allow the new 'replenish' alert type.
ALTER TABLE sourcing_alerts DROP CONSTRAINT IF EXISTS sourcing_alerts_type_chk;
ALTER TABLE sourcing_alerts ADD CONSTRAINT sourcing_alerts_type_chk
  CHECK (alert_type IN ('eol','discontinued','low_stock','demand_no_stock','replenish'));

-- 3. Enroll on SOLD. The function is exception-guarded: any failure is swallowed
--    so the surrounding ledger INSERT (a shipment) always commits.
CREATE OR REPLACE FUNCTION fn_replenish_on_sold() RETURNS trigger AS $$
BEGIN
  BEGIN
    INSERT INTO sourcing_alerts (sku_id, alert_type, severity, status, reason, opened_at, created_at, updated_at)
    SELECT sc.id, 'replenish', 'warn', 'open', 'Sold/shipped out — needs restock', now(), now(), now()
      FROM sku_catalog sc
     WHERE sc.sku = NEW.sku
    ON CONFLICT (sku_id, alert_type) WHERE status IN ('open','sourcing')
    DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    -- Never let replenish enrollment break a sale.
    NULL;
  END;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_replenish_on_sold ON sku_stock_ledger;
CREATE TRIGGER trg_replenish_on_sold
  AFTER INSERT ON sku_stock_ledger
  FOR EACH ROW
  WHEN (NEW.reason = 'SOLD' AND NEW.sku IS NOT NULL)
  EXECUTE FUNCTION fn_replenish_on_sold();

COMMENT ON FUNCTION fn_replenish_on_sold() IS
  'Auto-enrolls a SKU into a live replenish sourcing_alert when a SOLD ledger row is written (pack-out). Idempotent + exception-guarded.';

COMMIT;
