-- Link a finalized local pickup order to the single receiving row that owns its
-- scannable label (R-{id} QR) and its receiving-history row. One pickup PO =
-- one receiving entry (source='local_pickup'); items stay in
-- local_pickup_order_items (they have no zoho_item_id, so no receiving_lines).
ALTER TABLE local_pickup_orders
  ADD COLUMN IF NOT EXISTS receiving_id INTEGER REFERENCES receiving(id);

CREATE INDEX IF NOT EXISTS idx_local_pickup_orders_receiving_id
  ON local_pickup_orders (receiving_id);
