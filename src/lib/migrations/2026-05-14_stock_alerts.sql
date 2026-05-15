-- ============================================================================
-- 2026-05-14: Stock alerts
-- ============================================================================
-- Append-only-ish (with `resolved_at` for soft-close) table for inventory
-- signals worth surfacing to a human:
--   LOW_STOCK     — bin qty ≤ min_qty
--   NEVER_COUNTED — bin_contents.last_counted IS NULL
--   STALE_COUNT   — last_counted older than threshold (default 60 days)
--
-- A daily cron inserts new rows + resolves rows whose condition cleared.
-- UNIQUE on (sku, bin_id, alert_type, resolved_at IS NULL) keeps the table
-- from filling with duplicate open alerts.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS stock_alerts (
  id            BIGSERIAL PRIMARY KEY,
  sku           TEXT NOT NULL,
  bin_id        INT REFERENCES locations(id) ON DELETE SET NULL,
  alert_type    TEXT NOT NULL,
  threshold     INT,
  qty_at_trigger INT,
  triggered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at   TIMESTAMPTZ,
  notified_at   TIMESTAMPTZ,
  notes         TEXT
);

ALTER TABLE stock_alerts
  DROP CONSTRAINT IF EXISTS stock_alerts_type_chk;
ALTER TABLE stock_alerts
  ADD CONSTRAINT stock_alerts_type_chk
  CHECK (alert_type IN ('LOW_STOCK','NEVER_COUNTED','STALE_COUNT'));

-- One open alert per (sku, bin_id, type). Closed alerts (resolved_at IS NOT
-- NULL) don't participate so the history is preserved.
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_alerts_open
  ON stock_alerts(sku, COALESCE(bin_id, 0), alert_type)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_stock_alerts_open_lookup
  ON stock_alerts(triggered_at DESC) WHERE resolved_at IS NULL;

COMMENT ON TABLE stock_alerts IS 'Daily-cron-generated alerts for low qty / uncounted / stale-counted bin rows.';

COMMIT;
