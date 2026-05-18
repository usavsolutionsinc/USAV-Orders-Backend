-- ============================================================================
-- 2026-05-18: stock_alerts gains DRIFT alert type
-- ============================================================================
-- Extends the existing stock_alerts_type_chk CHECK constraint to permit a
-- fourth alert_type: 'DRIFT'. Used by /api/qstash/inventory/drift-check to
-- surface SKUs where sku_stock.stock disagrees with SUM(sku_stock_ledger)
-- per dimension — the canary that some writer bypassed the ledger.
--
-- Pure CHECK rewrite: idempotent, additive, zero data changes.
-- ============================================================================

BEGIN;

ALTER TABLE stock_alerts
  DROP CONSTRAINT IF EXISTS stock_alerts_type_chk;

ALTER TABLE stock_alerts
  ADD CONSTRAINT stock_alerts_type_chk
  CHECK (alert_type IN ('LOW_STOCK','NEVER_COUNTED','STALE_COUNT','DRIFT'));

COMMIT;
