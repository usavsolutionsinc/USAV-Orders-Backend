-- Stock audit ledger: every qty change logged with reason + staff
CREATE TABLE IF NOT EXISTS sku_stock_ledger (
  id         SERIAL PRIMARY KEY,
  sku        TEXT NOT NULL,
  delta      INTEGER NOT NULL,        -- positive = added, negative = removed
  reason     TEXT NOT NULL DEFAULT 'ADJUSTMENT',
  -- RECEIVED | SOLD | DAMAGED | ADJUSTMENT | RETURNED | SET | CYCLE_COUNT
  staff_id   INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sku_stock_ledger_sku
  ON sku_stock_ledger (sku);

CREATE INDEX IF NOT EXISTS idx_sku_stock_ledger_created
  ON sku_stock_ledger (created_at DESC);

COMMENT ON TABLE sku_stock_ledger IS 'Audit trail for every stock quantity change';
