-- Extend receiving + receiving_lines to support Zoho Purchase Order imports
-- (import POs into the receiving queue as PENDING expected inbound shipments)

ALTER TABLE receiving
  ADD COLUMN IF NOT EXISTS zoho_purchaseorder_id     TEXT,
  ADD COLUMN IF NOT EXISTS zoho_purchaseorder_number TEXT;

CREATE INDEX IF NOT EXISTS idx_receiving_zoho_po_id ON receiving(zoho_purchaseorder_id);

-- Additional receiving_lines columns used by PO + receive sync (idempotent)
ALTER TABLE receiving_lines
  ADD COLUMN IF NOT EXISTS zoho_purchase_receive_id TEXT,
  ADD COLUMN IF NOT EXISTS zoho_purchaseorder_id    TEXT,
  ADD COLUMN IF NOT EXISTS zoho_line_item_id        TEXT,
  ADD COLUMN IF NOT EXISTS item_name                TEXT,
  ADD COLUMN IF NOT EXISTS sku                      TEXT,
  ADD COLUMN IF NOT EXISTS quantity_received        INTEGER,
  ADD COLUMN IF NOT EXISTS quantity_expected        INTEGER,
  ADD COLUMN IF NOT EXISTS notes                    TEXT;

CREATE INDEX IF NOT EXISTS idx_receiving_lines_zoho_po_id ON receiving_lines(zoho_purchaseorder_id);
