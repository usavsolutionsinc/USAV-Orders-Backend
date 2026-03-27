-- Phase 1: SAL as Single Source of Truth
-- (a) Backfill context_station_activity_log_id on tech_serial_numbers where NULL
-- (b) Add station_activity_log_id FK to fba_fnsku_logs and backfill

BEGIN;

-- ============================================================================
-- (a) Backfill tech_serial_numbers.context_station_activity_log_id
-- ============================================================================

-- Strategy 1: Match via SERIAL_ADDED SAL that references this TSN row
UPDATE tech_serial_numbers tsn
SET context_station_activity_log_id = sub.sal_id
FROM (
  SELECT DISTINCT ON (sal.tech_serial_number_id)
    sal.tech_serial_number_id AS tsn_id,
    sal.id AS sal_id
  FROM station_activity_logs sal
  WHERE sal.activity_type = 'SERIAL_ADDED'
    AND sal.tech_serial_number_id IS NOT NULL
  ORDER BY sal.tech_serial_number_id, sal.created_at DESC
) sub
WHERE tsn.id = sub.tsn_id
  AND tsn.context_station_activity_log_id IS NULL;

-- Strategy 2: For FNSKU rows, find FNSKU_SCANNED SAL via fnsku_log_id in metadata
UPDATE tech_serial_numbers tsn
SET context_station_activity_log_id = sub.sal_id
FROM (
  SELECT DISTINCT ON (tsn2.id)
    tsn2.id AS tsn_id,
    sal.id AS sal_id
  FROM tech_serial_numbers tsn2
  JOIN station_activity_logs sal
    ON sal.activity_type = 'FNSKU_SCANNED'
    AND sal.station = 'TECH'
    AND (NULLIF(TRIM(sal.metadata->>'fnsku_log_id'), ''))::bigint = tsn2.fnsku_log_id
  WHERE tsn2.context_station_activity_log_id IS NULL
    AND tsn2.fnsku_log_id IS NOT NULL
  ORDER BY tsn2.id, sal.created_at DESC
) sub
WHERE tsn.id = sub.tsn_id
  AND tsn.context_station_activity_log_id IS NULL;

-- Strategy 3: For carrier tracking rows, find TRACKING_SCANNED SAL by shipment_id + staff
UPDATE tech_serial_numbers tsn
SET context_station_activity_log_id = sub.sal_id
FROM (
  SELECT DISTINCT ON (tsn2.id)
    tsn2.id AS tsn_id,
    sal.id AS sal_id
  FROM tech_serial_numbers tsn2
  JOIN station_activity_logs sal
    ON sal.activity_type = 'TRACKING_SCANNED'
    AND sal.station = 'TECH'
    AND sal.shipment_id = tsn2.shipment_id
    AND sal.staff_id = tsn2.tested_by
  WHERE tsn2.context_station_activity_log_id IS NULL
    AND tsn2.shipment_id IS NOT NULL
  ORDER BY tsn2.id, sal.created_at DESC
) sub
WHERE tsn.id = sub.tsn_id
  AND tsn.context_station_activity_log_id IS NULL;

-- ============================================================================
-- (b) Add station_activity_log_id to fba_fnsku_logs
-- ============================================================================

-- Add the column (nullable initially for backfill)
ALTER TABLE fba_fnsku_logs
  ADD COLUMN IF NOT EXISTS station_activity_log_id INTEGER REFERENCES station_activity_logs(id) ON DELETE SET NULL;

-- Backfill: match TECH FNSKU_SCANNED SAL rows by fnsku + staff_id + timestamp proximity
UPDATE fba_fnsku_logs fl
SET station_activity_log_id = sub.sal_id
FROM (
  SELECT DISTINCT ON (fl2.id)
    fl2.id AS fl_id,
    sal.id AS sal_id
  FROM fba_fnsku_logs fl2
  JOIN station_activity_logs sal
    ON sal.activity_type = 'FNSKU_SCANNED'
    AND sal.station = 'TECH'
    AND sal.fnsku = fl2.fnsku
    AND sal.staff_id = fl2.staff_id
    AND sal.created_at BETWEEN fl2.created_at - INTERVAL '10 seconds' AND fl2.created_at + INTERVAL '10 seconds'
  WHERE fl2.source_stage = 'TECH'
    AND fl2.station_activity_log_id IS NULL
  ORDER BY fl2.id, ABS(EXTRACT(EPOCH FROM (sal.created_at - fl2.created_at)))
) sub
WHERE fl.id = sub.fl_id
  AND fl.station_activity_log_id IS NULL;

-- Backfill: also try matching via SAL metadata.fnsku_log_id
UPDATE fba_fnsku_logs fl
SET station_activity_log_id = sub.sal_id
FROM (
  SELECT DISTINCT ON (fl2.id)
    fl2.id AS fl_id,
    sal.id AS sal_id
  FROM fba_fnsku_logs fl2
  JOIN station_activity_logs sal
    ON sal.station = 'TECH'
    AND (NULLIF(TRIM(sal.metadata->>'fnsku_log_id'), ''))::bigint = fl2.id
  WHERE fl2.station_activity_log_id IS NULL
  ORDER BY fl2.id, sal.created_at DESC
) sub
WHERE fl.id = sub.fl_id
  AND fl.station_activity_log_id IS NULL;

-- Create index for the FK join
CREATE INDEX IF NOT EXISTS idx_fba_fnsku_logs_sal_id
  ON fba_fnsku_logs (station_activity_log_id)
  WHERE station_activity_log_id IS NOT NULL;

-- Create index for TSN -> SAL lookup (improve join performance)
CREATE INDEX IF NOT EXISTS idx_tsn_context_sal_id
  ON tech_serial_numbers (context_station_activity_log_id)
  WHERE context_station_activity_log_id IS NOT NULL;

COMMIT;
