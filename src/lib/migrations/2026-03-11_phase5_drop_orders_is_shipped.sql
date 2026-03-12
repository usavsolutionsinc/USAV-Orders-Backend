-- Phase 5: Drop orders.is_shipped
--
-- Prerequisites — ALL must be complete before running:
--   Phase 2: all WRITE paths use shipment_id (no new rows written with text tracking only)
--   Phase 3: all READ paths JOIN via stn; no query reads orders.is_shipped
--   Phase 4: shipping_tracking_number dropped from packer_logs + tech_serial_numbers
--   Audit:   rg "is_shipped|isShipped" src/ --type ts  → zero results remaining
--
-- Rationale:
--   is_shipped is a denormalized boolean that duplicates state already held in
--   shipping_tracking_numbers (is_carrier_accepted, is_in_transit, is_delivered, etc).
--   It drifts from the carrier truth and is ambiguous (label created? picked up? delivered?).
--   Derived status from stn is always current and unambiguous.
--
-- After this migration, compute is_shipped in every query as:
--   COALESCE(stn.is_carrier_accepted OR stn.is_in_transit
--            OR stn.is_out_for_delivery OR stn.is_delivered, false)
--
-- See: 2026-03-11_shipment_status_migration_DECISION.md

BEGIN;

DO $$
DECLARE
  shipped_count INTEGER;
  col_exists    BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM   information_schema.columns
    WHERE  table_name  = 'orders'
      AND  column_name = 'is_shipped'
  ) INTO col_exists;

  IF NOT col_exists THEN
    RAISE NOTICE 'orders.is_shipped does not exist — nothing to do.';
    RETURN;
  END IF;

  SELECT COUNT(*) INTO shipped_count FROM orders WHERE is_shipped = true;
  RAISE NOTICE 'orders.is_shipped = true on % rows (informational)', shipped_count;

  -- Sanity: confirm shipping_tracking_numbers has shipments for those rows
  -- (if this is 0 and shipped_count > 0, derived status may differ from current boolean)
  DECLARE
    linked_shipped INTEGER;
  BEGIN
    SELECT COUNT(*) INTO linked_shipped
    FROM   orders o
    JOIN   shipping_tracking_numbers stn ON stn.id = o.shipment_id
    WHERE  o.is_shipped = true
      AND  (stn.is_carrier_accepted OR stn.is_in_transit
            OR stn.is_out_for_delivery OR stn.is_delivered);

    RAISE NOTICE '% of those rows have matching stn carrier-accepted/in-transit/delivered status',
                 linked_shipped;
  END;
END $$;

ALTER TABLE orders DROP COLUMN IF EXISTS is_shipped;

COMMIT;
