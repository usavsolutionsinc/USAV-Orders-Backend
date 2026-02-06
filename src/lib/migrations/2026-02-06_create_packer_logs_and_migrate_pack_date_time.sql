-- Migration: Create packer_logs audit table and migrate pack_date_time from orders
-- Purpose: Move pack_date_time to packer_logs while keeping shipping_tracking_number in orders
-- Date: 2026-02-06

BEGIN;

-- 1) Create packer_logs table
CREATE TABLE IF NOT EXISTS packer_logs (
  id SERIAL PRIMARY KEY,
  shipping_tracking_number TEXT NOT NULL,
  tracking_type VARCHAR(20) NOT NULL,
  pack_date_time TIMESTAMP,
  packed_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  packer_photos_url JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2) Helpful indexes
CREATE INDEX IF NOT EXISTS idx_packer_logs_tracking ON packer_logs (shipping_tracking_number);
CREATE INDEX IF NOT EXISTS idx_packer_logs_pack_date_time ON packer_logs (pack_date_time DESC);
CREATE INDEX IF NOT EXISTS idx_packer_logs_packed_by ON packer_logs (packed_by);

-- 3) Migrate existing pack_date_time values from orders
WITH source AS (
  SELECT
    o.shipping_tracking_number,
    o.packed_by,
    o.packer_photos_url,
    CASE
      WHEN o.pack_date_time IS NULL OR o.pack_date_time = '' OR o.pack_date_time = '1' THEN NULL
      WHEN o.pack_date_time ~ '^\d{2}/\d{2}/\d{4},' THEN to_timestamp(o.pack_date_time, 'MM/DD/YYYY, HH24:MI:SS')
      WHEN o.pack_date_time ~ '^\d{2}/\d{2}/\d{4} ' THEN to_timestamp(o.pack_date_time, 'MM/DD/YYYY HH24:MI:SS')
      WHEN o.pack_date_time ~ '^\d{4}-\d{2}-\d{2}' THEN o.pack_date_time::timestamp
      ELSE NULL
    END AS parsed_pack_date_time
  FROM orders o
  WHERE o.shipping_tracking_number IS NOT NULL
    AND o.shipping_tracking_number != ''
)
INSERT INTO packer_logs (
  shipping_tracking_number,
  tracking_type,
  pack_date_time,
  packed_by,
  packer_photos_url
)
SELECT
  s.shipping_tracking_number,
  'ORDERS'::varchar,
  s.parsed_pack_date_time,
  s.packed_by,
  s.packer_photos_url
FROM source s
WHERE s.parsed_pack_date_time IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM packer_logs pl
    WHERE pl.shipping_tracking_number = s.shipping_tracking_number
      AND pl.tracking_type = 'ORDERS'
      AND pl.pack_date_time = s.parsed_pack_date_time
  );

-- 4) Drop pack_date_time from orders (shipping_tracking_number stays)
ALTER TABLE orders DROP COLUMN IF EXISTS pack_date_time;

COMMIT;
