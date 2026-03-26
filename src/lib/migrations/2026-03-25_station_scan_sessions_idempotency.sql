-- Anchors tech station context (tracking → serials) and caches idempotent POST bodies.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS station_scan_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id INTEGER NOT NULL REFERENCES staff(id),
  session_kind VARCHAR(20) NOT NULL DEFAULT 'ORDER',
  shipment_id BIGINT REFERENCES shipping_tracking_numbers(id),
  orders_exception_id INTEGER REFERENCES orders_exceptions(id),
  repair_service_id INTEGER,
  tracking_key18 TEXT,
  tracking_raw TEXT,
  scan_ref TEXT,
  fnsku TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '12 hours')
);

CREATE INDEX IF NOT EXISTS idx_station_scan_sessions_staff_expires
  ON station_scan_sessions(staff_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS api_idempotency_responses (
  idempotency_key TEXT NOT NULL,
  route TEXT NOT NULL,
  staff_id INTEGER,
  status_code INTEGER NOT NULL,
  response_body JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (idempotency_key, route)
);

CREATE INDEX IF NOT EXISTS idx_api_idempotency_route_created
  ON api_idempotency_responses(route, created_at DESC);
