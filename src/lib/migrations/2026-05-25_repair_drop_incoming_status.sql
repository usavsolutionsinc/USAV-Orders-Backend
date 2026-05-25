-- Use repair_service.status = 'Incoming Shipment' for the walk-in "Incoming" tab.
-- Backfill from legacy incoming_status = 'incoming', then drop the column.

UPDATE repair_service
SET status = 'Incoming Shipment',
    updated_at = NOW()
WHERE COALESCE(incoming_status, '') = 'incoming'
  AND COALESCE(TRIM(status), '') NOT IN ('Done', 'Picked Up', 'Shipped');

DROP INDEX IF EXISTS idx_repair_service_incoming_status;

ALTER TABLE repair_service DROP COLUMN IF EXISTS incoming_status;

CREATE INDEX IF NOT EXISTS idx_repair_service_status_created_desc
  ON repair_service (status, created_at DESC);
