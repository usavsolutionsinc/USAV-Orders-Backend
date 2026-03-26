-- Anchor each tech_serial_numbers row to the station_activity_logs row that defined scan context
-- (TRACKING_SCANNED / FNSKU_SCANNED, or chained from SERIAL_ADDED → prior TSN). Duplicate detection
-- uses this FK instead of matching on tech_serial_numbers.scan_ref.
BEGIN;

ALTER TABLE tech_serial_numbers
  ADD COLUMN IF NOT EXISTS context_station_activity_log_id INTEGER
    REFERENCES station_activity_logs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tech_serial_numbers_context_sal
  ON tech_serial_numbers(context_station_activity_log_id)
  WHERE context_station_activity_log_id IS NOT NULL;

COMMIT;
