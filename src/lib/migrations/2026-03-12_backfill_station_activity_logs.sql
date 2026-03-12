BEGIN;

INSERT INTO station_activity_logs (
  station,
  activity_type,
  shipment_id,
  scan_ref,
  staff_id,
  notes,
  metadata,
  created_at,
  updated_at
)
SELECT
  'TECH',
  'TRACKING_SCANNED',
  tsn.shipment_id,
  tsn.scan_ref,
  tsn.tested_by,
  tsn.notes,
  '{}'::jsonb,
  COALESCE(tsn.created_at, NOW()),
  COALESCE(tsn.updated_at, tsn.created_at, NOW())
FROM tech_serial_numbers tsn
WHERE (tsn.serial_number IS NULL OR BTRIM(tsn.serial_number) = '')
  AND (tsn.shipment_id IS NOT NULL OR COALESCE(tsn.scan_ref, '') <> '')
  AND NOT EXISTS (
    SELECT 1
    FROM station_activity_logs sal
    WHERE sal.station = 'TECH'
      AND sal.activity_type = 'TRACKING_SCANNED'
      AND sal.staff_id IS NOT DISTINCT FROM tsn.tested_by
      AND (
        (tsn.shipment_id IS NOT NULL AND sal.shipment_id = tsn.shipment_id)
        OR (
          COALESCE(tsn.scan_ref, '') <> ''
          AND RIGHT(regexp_replace(UPPER(COALESCE(sal.scan_ref, '')), '[^A-Z0-9]', '', 'g'), 18) =
              RIGHT(regexp_replace(UPPER(COALESCE(tsn.scan_ref, '')), '[^A-Z0-9]', '', 'g'), 18)
        )
      )
  );

INSERT INTO station_activity_logs (
  station,
  activity_type,
  shipment_id,
  scan_ref,
  fnsku,
  staff_id,
  fba_shipment_id,
  fba_shipment_item_id,
  tech_serial_number_id,
  notes,
  metadata,
  created_at,
  updated_at
)
SELECT
  'TECH',
  'SERIAL_ADDED',
  tsn.shipment_id,
  tsn.scan_ref,
  tsn.fnsku,
  tsn.tested_by,
  tsn.fba_shipment_id,
  tsn.fba_shipment_item_id,
  tsn.id,
  tsn.notes,
  jsonb_build_object(
    'serial_number', tsn.serial_number,
    'fnsku_log_id', tsn.fnsku_log_id
  ),
  COALESCE(tsn.created_at, NOW()),
  COALESCE(tsn.updated_at, tsn.created_at, NOW())
FROM tech_serial_numbers tsn
WHERE tsn.serial_number IS NOT NULL
  AND BTRIM(tsn.serial_number) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM station_activity_logs sal
    WHERE sal.station = 'TECH'
      AND sal.activity_type = 'SERIAL_ADDED'
      AND sal.tech_serial_number_id = tsn.id
  );

INSERT INTO station_activity_logs (
  station,
  activity_type,
  scan_ref,
  fnsku,
  staff_id,
  fba_shipment_id,
  fba_shipment_item_id,
  notes,
  metadata,
  created_at,
  updated_at
)
SELECT
  CASE l.source_stage WHEN 'TECH' THEN 'TECH' WHEN 'PACK' THEN 'PACK' ELSE 'ADMIN' END,
  CASE
    WHEN l.source_stage = 'TECH' AND l.event_type = 'SCANNED' THEN 'FNSKU_SCANNED'
    WHEN l.source_stage = 'PACK' AND l.event_type IN ('READY', 'VERIFIED', 'BOXED') THEN 'FBA_READY'
    ELSE 'PACK_SCAN'
  END,
  l.fnsku,
  l.fnsku,
  l.staff_id,
  l.fba_shipment_id,
  l.fba_shipment_item_id,
  l.notes,
  COALESCE(l.metadata, '{}'::jsonb) || jsonb_build_object('fnsku_log_id', l.id),
  l.created_at,
  l.created_at
FROM fba_fnsku_logs l
WHERE l.source_stage IN ('TECH', 'PACK')
  AND l.event_type IN ('SCANNED', 'READY', 'VERIFIED', 'BOXED')
  AND NOT EXISTS (
    SELECT 1
    FROM station_activity_logs sal
    WHERE sal.station = CASE l.source_stage WHEN 'TECH' THEN 'TECH' WHEN 'PACK' THEN 'PACK' ELSE 'ADMIN' END
      AND sal.fnsku = l.fnsku
      AND sal.staff_id IS NOT DISTINCT FROM l.staff_id
      AND sal.created_at = l.created_at
      AND sal.activity_type = CASE
        WHEN l.source_stage = 'TECH' AND l.event_type = 'SCANNED' THEN 'FNSKU_SCANNED'
        WHEN l.source_stage = 'PACK' AND l.event_type IN ('READY', 'VERIFIED', 'BOXED') THEN 'FBA_READY'
        ELSE 'PACK_SCAN'
      END
  );

INSERT INTO station_activity_logs (
  station,
  activity_type,
  shipment_id,
  scan_ref,
  staff_id,
  packer_log_id,
  notes,
  metadata,
  created_at,
  updated_at
)
SELECT
  'PACK',
  CASE WHEN pl.tracking_type = 'ORDERS' THEN 'PACK_COMPLETED' ELSE 'PACK_SCAN' END,
  pl.shipment_id,
  pl.scan_ref,
  pl.packed_by,
  pl.id,
  NULL,
  jsonb_build_object('tracking_type', pl.tracking_type),
  COALESCE(pl.created_at, NOW()),
  COALESCE(pl.updated_at, pl.created_at, NOW())
FROM packer_logs pl
WHERE NOT EXISTS (
  SELECT 1
  FROM station_activity_logs sal
  WHERE sal.station = 'PACK'
    AND sal.packer_log_id = pl.id
);

COMMIT;
