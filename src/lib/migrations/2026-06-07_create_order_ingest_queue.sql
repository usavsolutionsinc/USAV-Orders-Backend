-- 2026-06-07 Order ingest queue (outbox)
-- Replaces the QStash event queue for external order ingest. The producer
-- (/api/zoho/orders/ingest) inserts one row per order; the drain cron
-- (/api/cron/zoho/orders-ingest-drain) processes pending rows every minute.
-- UNIQUE(channel_order_id) is the dedup that QStash's deduplicationId provided.

CREATE TABLE IF NOT EXISTS order_ingest_queue (
  id               BIGSERIAL PRIMARY KEY,
  channel_order_id TEXT NOT NULL UNIQUE,
  organization_id  TEXT,
  payload          JSONB NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts         INTEGER NOT NULL DEFAULT 0,
  last_error       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at     TIMESTAMPTZ
);

-- Drain claim reads pending oldest-first.
CREATE INDEX IF NOT EXISTS idx_order_ingest_queue_pending
  ON order_ingest_queue(created_at)
  WHERE status = 'pending';
