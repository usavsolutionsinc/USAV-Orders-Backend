-- Phase 0: Fix backfill for rows where shipping_tracking_number was stored lowercase.
-- Bug: prior SQL UPDATE used [^A-Z0-9] regex BEFORE applying UPPER(), stripping lowercase letters.
-- Fix: apply UPPER() first, then strip non-alphanum chars.

UPDATE tech_serial_numbers tsn
SET    shipment_id = stn.id
FROM   shipping_tracking_numbers stn
WHERE  stn.tracking_number_normalized =
         UPPER(REGEXP_REPLACE(UPPER(COALESCE(tsn.shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'))
  AND  tsn.shipment_id IS NULL
  AND  tsn.shipping_tracking_number IS NOT NULL
  AND  tsn.shipping_tracking_number <> '';

-- Also fix packer_logs and orders_exceptions with the same bug
UPDATE packer_logs pl
SET    shipment_id = stn.id
FROM   shipping_tracking_numbers stn
WHERE  stn.tracking_number_normalized =
         UPPER(REGEXP_REPLACE(UPPER(COALESCE(pl.shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'))
  AND  pl.shipment_id IS NULL
  AND  pl.shipping_tracking_number IS NOT NULL;

UPDATE orders_exceptions oe
SET    shipment_id = stn.id
FROM   shipping_tracking_numbers stn
WHERE  stn.tracking_number_normalized =
         UPPER(REGEXP_REPLACE(UPPER(COALESCE(oe.shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'))
  AND  oe.shipment_id IS NULL
  AND  oe.shipping_tracking_number IS NOT NULL;
