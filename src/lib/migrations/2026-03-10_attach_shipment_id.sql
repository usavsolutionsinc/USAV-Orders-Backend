-- Attach shipment_id FK to all business tables that hold a raw shipping_tracking_number.
-- This is a safe, non-destructive migration — the old TEXT columns stay untouched.
-- Existing code continues to work; new code can JOIN through shipment_id.

BEGIN;

-- 1. Add nullable FK column to each business table
ALTER TABLE orders            ADD COLUMN IF NOT EXISTS shipment_id BIGINT REFERENCES shipping_tracking_numbers(id) ON DELETE SET NULL;
ALTER TABLE tech_serial_numbers ADD COLUMN IF NOT EXISTS shipment_id BIGINT REFERENCES shipping_tracking_numbers(id) ON DELETE SET NULL;
ALTER TABLE packer_logs       ADD COLUMN IF NOT EXISTS shipment_id BIGINT REFERENCES shipping_tracking_numbers(id) ON DELETE SET NULL;
ALTER TABLE orders_exceptions ADD COLUMN IF NOT EXISTS shipment_id BIGINT REFERENCES shipping_tracking_numbers(id) ON DELETE SET NULL;
ALTER TABLE sku               ADD COLUMN IF NOT EXISTS shipment_id BIGINT REFERENCES shipping_tracking_numbers(id) ON DELETE SET NULL;

-- 2. Partial indexes — only index rows that actually have a shipment link
CREATE INDEX IF NOT EXISTS idx_orders_shipment_id            ON orders(shipment_id)            WHERE shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tech_serial_shipment_id       ON tech_serial_numbers(shipment_id) WHERE shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_packer_logs_shipment_id       ON packer_logs(shipment_id)       WHERE shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_exceptions_shipment_id ON orders_exceptions(shipment_id) WHERE shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sku_shipment_id               ON sku(shipment_id)               WHERE shipment_id IS NOT NULL;

-- 3. Backfill shipment_id on orders by matching the normalized tracking string
--    (shipping_tracking_numbers was pre-populated by the backfill Node script)
UPDATE orders o
SET    shipment_id = stn.id
FROM   shipping_tracking_numbers stn
WHERE  stn.tracking_number_normalized
         = UPPER(REGEXP_REPLACE(COALESCE(o.shipping_tracking_number, ''), '[^A-Z0-9]', '', 'g'))
  AND  o.shipping_tracking_number IS NOT NULL
  AND  o.shipping_tracking_number <> ''
  AND  o.shipment_id IS NULL;

-- 4. Backfill tech_serial_numbers
UPDATE tech_serial_numbers tsn
SET    shipment_id = stn.id
FROM   shipping_tracking_numbers stn
WHERE  stn.tracking_number_normalized
         = UPPER(REGEXP_REPLACE(COALESCE(tsn.shipping_tracking_number, ''), '[^A-Z0-9]', '', 'g'))
  AND  tsn.shipping_tracking_number IS NOT NULL
  AND  tsn.shipping_tracking_number <> ''
  AND  tsn.shipment_id IS NULL;

-- 5. Backfill packer_logs
UPDATE packer_logs pl
SET    shipment_id = stn.id
FROM   shipping_tracking_numbers stn
WHERE  stn.tracking_number_normalized
         = UPPER(REGEXP_REPLACE(COALESCE(pl.shipping_tracking_number, ''), '[^A-Z0-9]', '', 'g'))
  AND  pl.shipping_tracking_number IS NOT NULL
  AND  pl.shipment_id IS NULL;

-- 6. Backfill orders_exceptions
UPDATE orders_exceptions oe
SET    shipment_id = stn.id
FROM   shipping_tracking_numbers stn
WHERE  stn.tracking_number_normalized
         = UPPER(REGEXP_REPLACE(COALESCE(oe.shipping_tracking_number, ''), '[^A-Z0-9]', '', 'g'))
  AND  oe.shipping_tracking_number IS NOT NULL
  AND  oe.shipment_id IS NULL;

-- 7. Backfill sku table
UPDATE sku s
SET    shipment_id = stn.id
FROM   shipping_tracking_numbers stn
WHERE  stn.tracking_number_normalized
         = UPPER(REGEXP_REPLACE(COALESCE(s.shipping_tracking_number, ''), '[^A-Z0-9]', '', 'g'))
  AND  s.shipping_tracking_number IS NOT NULL
  AND  s.shipping_tracking_number <> ''
  AND  s.shipment_id IS NULL;

COMMIT;
