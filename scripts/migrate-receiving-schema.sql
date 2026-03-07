-- ============================================================
-- Receiving Schema Migration
-- Goal: remove overlap, delegate receiving_lines to Zoho data
-- ============================================================

BEGIN;

-- ── 1. receiving: make condition_grade & disposition_code nullable
--    These are per-item concerns; on `receiving` they're only meaningful
--    for non-PO bulk scans. PO receives should rely on receiving_lines.
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE receiving
  ALTER COLUMN condition_grade DROP NOT NULL;

ALTER TABLE receiving
  ALTER COLUMN disposition_code DROP NOT NULL;

-- ── 2. receiving_lines: add full Zoho inventory identity columns
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE receiving_lines
  ADD COLUMN IF NOT EXISTS item_name                TEXT,
  ADD COLUMN IF NOT EXISTS sku                      TEXT,
  ADD COLUMN IF NOT EXISTS quantity_expected        INTEGER,
  ADD COLUMN IF NOT EXISTS quantity_received        INTEGER,
  ADD COLUMN IF NOT EXISTS zoho_line_item_id        TEXT,
  ADD COLUMN IF NOT EXISTS zoho_purchase_receive_id TEXT,
  ADD COLUMN IF NOT EXISTS notes                    TEXT,
  ADD COLUMN IF NOT EXISTS created_at               TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── 3. Back-fill quantity_received from existing quantity column
--    (quantity column kept for backward compat until API is updated)
-- ────────────────────────────────────────────────────────────────────
UPDATE receiving_lines
  SET quantity_received = quantity
  WHERE quantity_received IS NULL AND quantity IS NOT NULL;

-- ── 4. Indexes for common access patterns
-- ────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_receiving_lines_receiving_id
  ON receiving_lines(receiving_id);

CREATE INDEX IF NOT EXISTS idx_receiving_lines_zoho_item_id
  ON receiving_lines(zoho_item_id);

CREATE INDEX IF NOT EXISTS idx_receiving_lines_sku
  ON receiving_lines(sku)
  WHERE sku IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receiving_lines_zoho_pr_id
  ON receiving_lines(zoho_purchase_receive_id)
  WHERE zoho_purchase_receive_id IS NOT NULL;

-- ── 5. Verify final column list
-- ────────────────────────────────────────────────────────────────────
SELECT
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name IN ('receiving', 'receiving_lines')
ORDER BY table_name, ordinal_position;

COMMIT;
