-- Normalize Zoho inbound sync around receiving_lines as the system-of-work.
-- Adds sync metadata for incremental reconciliation and unique keys so line
-- imports are idempotent at the database level.

ALTER TABLE receiving_lines
  ADD COLUMN IF NOT EXISTS zoho_sync_source TEXT,
  ADD COLUMN IF NOT EXISTS zoho_last_modified_time TEXT,
  ADD COLUMN IF NOT EXISTS zoho_synced_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS ux_receiving_lines_zoho_po_line
  ON receiving_lines(zoho_purchaseorder_id, zoho_line_item_id)
  WHERE zoho_purchaseorder_id IS NOT NULL
    AND zoho_line_item_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_receiving_lines_zoho_pr_line
  ON receiving_lines(zoho_purchase_receive_id, zoho_line_item_id)
  WHERE zoho_purchase_receive_id IS NOT NULL
    AND zoho_line_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receiving_lines_zoho_last_modified_time
  ON receiving_lines(zoho_last_modified_time)
  WHERE zoho_last_modified_time IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_receiving_lines_zoho_synced_at
  ON receiving_lines(zoho_synced_at DESC)
  WHERE zoho_synced_at IS NOT NULL;
