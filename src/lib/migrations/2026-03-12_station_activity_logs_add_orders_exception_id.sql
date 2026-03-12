BEGIN;

ALTER TABLE station_activity_logs
  ADD COLUMN IF NOT EXISTS orders_exception_id INTEGER REFERENCES orders_exceptions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_station_activity_logs_orders_exception_id
  ON station_activity_logs(orders_exception_id)
  WHERE orders_exception_id IS NOT NULL;

COMMIT;
