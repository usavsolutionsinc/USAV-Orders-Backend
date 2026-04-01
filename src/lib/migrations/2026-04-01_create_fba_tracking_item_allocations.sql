-- Per-tracking bundle allocations for FBA shipments.
-- A shipment can have one tracking row that bundles many shipment items/FNSKUs.

BEGIN;

CREATE TABLE IF NOT EXISTS fba_tracking_item_allocations (
  id                BIGSERIAL PRIMARY KEY,
  shipment_id       INTEGER NOT NULL REFERENCES fba_shipments(id) ON DELETE CASCADE,
  tracking_id       BIGINT  NOT NULL REFERENCES shipping_tracking_numbers(id) ON DELETE CASCADE,
  shipment_item_id  INTEGER NOT NULL REFERENCES fba_shipment_items(id) ON DELETE CASCADE,
  qty               INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ux_fba_tracking_item_allocations_bundle_item
    UNIQUE (shipment_id, tracking_id, shipment_item_id)
);

CREATE INDEX IF NOT EXISTS idx_fba_tracking_item_allocations_shipment_tracking
  ON fba_tracking_item_allocations (shipment_id, tracking_id);

CREATE INDEX IF NOT EXISTS idx_fba_tracking_item_allocations_item
  ON fba_tracking_item_allocations (shipment_item_id);

COMMIT;
