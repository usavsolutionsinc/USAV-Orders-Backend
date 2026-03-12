BEGIN;

CREATE TABLE IF NOT EXISTS station_activity_logs (
  id                    SERIAL PRIMARY KEY,
  station               VARCHAR(20) NOT NULL,
  activity_type         VARCHAR(30) NOT NULL,
  shipment_id           BIGINT REFERENCES shipping_tracking_numbers(id) ON DELETE SET NULL,
  scan_ref              TEXT,
  fnsku                 TEXT REFERENCES fba_fnskus(fnsku) ON DELETE SET NULL,
  staff_id              INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  fba_shipment_id       INTEGER REFERENCES fba_shipments(id) ON DELETE SET NULL,
  fba_shipment_item_id  INTEGER REFERENCES fba_shipment_items(id) ON DELETE SET NULL,
  tech_serial_number_id INTEGER,
  packer_log_id         INTEGER,
  notes                 TEXT,
  metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_station_activity_logs_station_staff_created
  ON station_activity_logs(station, staff_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_station_activity_logs_shipment_id
  ON station_activity_logs(shipment_id)
  WHERE shipment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_station_activity_logs_scan_ref_key18
  ON station_activity_logs (
    RIGHT(regexp_replace(UPPER(COALESCE(scan_ref, '')), '[^A-Z0-9]', '', 'g'), 18)
  )
  WHERE scan_ref IS NOT NULL AND scan_ref <> '';

CREATE INDEX IF NOT EXISTS idx_station_activity_logs_fnsku
  ON station_activity_logs(fnsku, created_at DESC)
  WHERE fnsku IS NOT NULL;

COMMIT;
