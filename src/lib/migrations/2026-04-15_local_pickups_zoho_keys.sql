-- ============================================================================
-- 2026-04-15: Zoho identity keys on local_pickup_orders + local_pickup_order_items
-- ============================================================================
-- Lets the Zoho sync auto-route POs flagged with LCPU/LOCALPICKUP straight into
-- the local-pickup tables (bypassing receiving + receiving_lines + shipping
-- altogether — local pickups have no carrier tracking and no shipment).
--
-- The unique partial indexes give us idempotent upserts:
--   - one local_pickup_orders row per Zoho PO id
--   - one local_pickup_order_items row per (order_id, Zoho line_item_id)
-- ============================================================================

BEGIN;

ALTER TABLE local_pickup_orders
  ADD COLUMN IF NOT EXISTS zoho_po_id                  TEXT,
  ADD COLUMN IF NOT EXISTS zoho_purchaseorder_number   TEXT,
  ADD COLUMN IF NOT EXISTS zoho_reference_number       TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_local_pickup_orders_zoho_po
  ON local_pickup_orders (zoho_po_id)
  WHERE zoho_po_id IS NOT NULL;

ALTER TABLE local_pickup_order_items
  ADD COLUMN IF NOT EXISTS zoho_item_id        TEXT,
  ADD COLUMN IF NOT EXISTS zoho_line_item_id   TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_local_pickup_order_items_zoho_line
  ON local_pickup_order_items (order_id, zoho_line_item_id)
  WHERE zoho_line_item_id IS NOT NULL;

COMMENT ON COLUMN local_pickup_orders.zoho_po_id IS
  'Zoho Purchase Order id when this pickup originated from a Zoho PO flagged LCPU/LOCALPICKUP. NULL for manually-created in-store pickups.';
COMMENT ON COLUMN local_pickup_order_items.zoho_line_item_id IS
  'Zoho PO line_item_id for items synced from a Zoho LCPU PO. Combined with order_id for idempotent upserts.';

COMMIT;
