-- Link table to support multiple shipment IDs per order row while preserving
-- orders.shipment_id as the canonical primary FK for backward compatibility.
CREATE TABLE IF NOT EXISTS order_shipment_links (
  order_row_id integer NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  shipment_id bigint NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_row_id, shipment_id)
);

CREATE INDEX IF NOT EXISTS order_shipment_links_shipment_id_idx
  ON order_shipment_links (shipment_id);

CREATE INDEX IF NOT EXISTS order_shipment_links_order_row_id_idx
  ON order_shipment_links (order_row_id);

CREATE INDEX IF NOT EXISTS order_shipment_links_primary_idx
  ON order_shipment_links (order_row_id, is_primary);

-- Keep updated_at fresh on updates.
CREATE OR REPLACE FUNCTION set_order_shipment_links_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_order_shipment_links_updated_at ON order_shipment_links;
CREATE TRIGGER trg_order_shipment_links_updated_at
BEFORE UPDATE ON order_shipment_links
FOR EACH ROW
EXECUTE FUNCTION set_order_shipment_links_updated_at();

-- Backfill canonical shipment links from orders.shipment_id.
INSERT INTO order_shipment_links (order_row_id, shipment_id, is_primary, source)
SELECT o.id, o.shipment_id, true, 'orders.shipment_id.backfill'
FROM orders o
WHERE o.shipment_id IS NOT NULL
ON CONFLICT (order_row_id, shipment_id) DO UPDATE
SET is_primary = EXCLUDED.is_primary,
    source = EXCLUDED.source,
    updated_at = NOW();
