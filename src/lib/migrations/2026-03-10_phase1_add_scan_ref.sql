-- Phase 1: Add scan_ref to packer_logs for non-carrier scan types (SKU, FBA, CLEAN).
-- This column holds the raw scan input for rows where shipping_tracking_number is NOT
-- a carrier tracking number (so shipment_id stays NULL for those rows).
-- After all write paths are updated to use scan_ref, shipping_tracking_number can be dropped.

BEGIN;

ALTER TABLE packer_logs ADD COLUMN IF NOT EXISTS scan_ref TEXT;

-- Backfill scan_ref from shipping_tracking_number for all non-ORDERS rows
UPDATE packer_logs
SET    scan_ref = shipping_tracking_number
WHERE  tracking_type <> 'ORDERS'
  AND  scan_ref IS NULL
  AND  shipping_tracking_number IS NOT NULL;

-- For ORDERS rows where shipment_id is set, scan_ref stays NULL:
-- the raw tracking number is recoverable via JOIN shipping_tracking_numbers.tracking_number_raw

COMMIT;
