-- Phase 4: Drop duplicate shipping_tracking_number text columns.
-- ONLY run this after Phases 2 (writes) and 3 (reads) are fully deployed and verified.
-- Both tables must have zero code paths reading/writing the text column before running this.

BEGIN;

-- Verify coverage before dropping (will error if unacceptable gaps remain)
DO $$
DECLARE
  unlinked_orders_packer   INTEGER;
  unlinked_orders_tech     INTEGER;
BEGIN
  SELECT COUNT(*) INTO unlinked_orders_packer
  FROM packer_logs
  WHERE tracking_type = 'ORDERS' AND shipment_id IS NULL;

  SELECT COUNT(*) INTO unlinked_orders_tech
  FROM tech_serial_numbers
  WHERE shipment_id IS NULL
    AND UPPER(REGEXP_REPLACE(UPPER(COALESCE(shipping_tracking_number,'')), '[^A-Z0-9]','','g'))
        ~ '^1Z[A-Z0-9]{16}$|^9[0-9]{15,21}$|^[0-9]{12}$|^[0-9]{15}$|^[0-9]{20}$';

  IF unlinked_orders_packer > 0 THEN
    RAISE EXCEPTION 'Abort: % ORDERS-type packer_logs rows have no shipment_id. Run Phase 2 writes first.', unlinked_orders_packer;
  END IF;

  IF unlinked_orders_tech > 0 THEN
    RAISE EXCEPTION 'Abort: % carrier-tracking tech_serial rows have no shipment_id. Fix backfill first.', unlinked_orders_tech;
  END IF;

  RAISE NOTICE 'Coverage check passed. Proceeding with column drops.';
END $$;

-- Drop from packer_logs
ALTER TABLE packer_logs DROP COLUMN IF EXISTS shipping_tracking_number;

-- Drop from tech_serial_numbers
ALTER TABLE tech_serial_numbers DROP COLUMN IF EXISTS shipping_tracking_number;

-- Partial index ensuring ORDERS-type packer logs always have a shipment link
CREATE INDEX IF NOT EXISTS idx_packer_logs_orders_must_have_shipment
  ON packer_logs(shipment_id)
  WHERE tracking_type = 'ORDERS';

COMMIT;
