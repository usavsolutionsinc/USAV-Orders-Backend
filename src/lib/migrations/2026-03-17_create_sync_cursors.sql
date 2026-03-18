CREATE TABLE IF NOT EXISTS sync_cursors (
  resource TEXT PRIMARY KEY,
  last_synced_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sync_cursors_last_synced_at
  ON sync_cursors(last_synced_at DESC);
