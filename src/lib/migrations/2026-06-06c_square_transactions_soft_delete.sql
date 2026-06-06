-- Walk-in Sales soft-delete.
--
-- square_transactions is a local mirror of Square orders, so a hard delete is
-- wrong: the next /api/walk-in/sync or Square webhook would just re-insert the
-- row. Instead we hide it locally with deleted_at. The sync's
-- `ON CONFLICT (square_order_id) DO UPDATE` never touches deleted_at, so a
-- hidden sale stays hidden across re-syncs.
--
-- Additive + idempotent: safe to run on a live table.

ALTER TABLE square_transactions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- The list query filters `deleted_at IS NULL`; a partial index keeps that cheap
-- as the (rare) hidden set grows.
CREATE INDEX IF NOT EXISTS idx_square_transactions_active
  ON square_transactions (created_at DESC)
  WHERE deleted_at IS NULL;
