-- Add intake/source tracking columns for incoming shipment and pickup repairs.

ALTER TABLE repair_service
  ADD COLUMN IF NOT EXISTS source_system TEXT,
  ADD COLUMN IF NOT EXISTS source_order_id TEXT,
  ADD COLUMN IF NOT EXISTS source_tracking_number TEXT,
  ADD COLUMN IF NOT EXISTS source_sku TEXT,
  ADD COLUMN IF NOT EXISTS intake_channel TEXT,
  ADD COLUMN IF NOT EXISTS incoming_status TEXT,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS intake_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS received_by_staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_repair_service_incoming_status
  ON repair_service (incoming_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_repair_service_source_tracking
  ON repair_service (source_tracking_number);

CREATE UNIQUE INDEX IF NOT EXISTS ux_repair_service_ecwid_source
  ON repair_service (source_system, source_order_id, source_sku)
  WHERE source_system = 'ecwid'
    AND source_order_id IS NOT NULL
    AND source_sku IS NOT NULL;
