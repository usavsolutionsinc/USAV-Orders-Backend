-- Phase 1: Shipping Backbone Tables
-- Two focused tables: shipment master record + append-only carrier event history

CREATE TABLE IF NOT EXISTS shipping_tracking_numbers (
  id BIGSERIAL PRIMARY KEY,

  tracking_number_raw TEXT NOT NULL,
  tracking_number_normalized TEXT NOT NULL UNIQUE,

  carrier TEXT NOT NULL,
  carrier_account_ref TEXT,
  source_system TEXT,

  latest_status_code TEXT,
  latest_status_label TEXT,
  latest_status_description TEXT,
  latest_status_category TEXT, -- LABEL_CREATED, ACCEPTED, IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, EXCEPTION, RETURNED, UNKNOWN

  is_label_created BOOLEAN NOT NULL DEFAULT false,
  is_carrier_accepted BOOLEAN NOT NULL DEFAULT false,
  is_in_transit BOOLEAN NOT NULL DEFAULT false,
  is_out_for_delivery BOOLEAN NOT NULL DEFAULT false,
  is_delivered BOOLEAN NOT NULL DEFAULT false,
  has_exception BOOLEAN NOT NULL DEFAULT false,
  is_terminal BOOLEAN NOT NULL DEFAULT false,

  label_created_at TIMESTAMPTZ,
  carrier_accepted_at TIMESTAMPTZ,
  first_in_transit_at TIMESTAMPTZ,
  out_for_delivery_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  exception_at TIMESTAMPTZ,

  latest_event_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  next_check_at TIMESTAMPTZ,

  check_attempt_count INTEGER NOT NULL DEFAULT 0,
  consecutive_error_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_message TEXT,

  latest_payload JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS shipment_tracking_events (
  id BIGSERIAL PRIMARY KEY,

  shipment_id BIGINT NOT NULL REFERENCES shipping_tracking_numbers(id) ON DELETE CASCADE,

  carrier TEXT NOT NULL,
  tracking_number_normalized TEXT NOT NULL,

  external_event_id TEXT,
  external_status_code TEXT,
  external_status_label TEXT,
  external_status_description TEXT,

  normalized_status_category TEXT NOT NULL, -- LABEL_CREATED, ACCEPTED, IN_TRANSIT, OUT_FOR_DELIVERY, DELIVERED, EXCEPTION, RETURNED, UNKNOWN

  event_occurred_at TIMESTAMPTZ,
  event_recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  event_city TEXT,
  event_state TEXT,
  event_postal_code TEXT,
  event_country_code TEXT,

  signed_by TEXT,
  exception_code TEXT,
  exception_description TEXT,

  payload JSONB NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_shipments_tracking_normalized
  ON shipping_tracking_numbers(tracking_number_normalized);

CREATE INDEX IF NOT EXISTS idx_shipments_next_check
  ON shipping_tracking_numbers(next_check_at)
  WHERE is_terminal = false;

CREATE INDEX IF NOT EXISTS idx_shipments_carrier
  ON shipping_tracking_numbers(carrier);

CREATE INDEX IF NOT EXISTS idx_events_shipment_id_time
  ON shipment_tracking_events(shipment_id, event_occurred_at DESC);

-- Deduplication key: same shipment + same event identity + same time
CREATE UNIQUE INDEX IF NOT EXISTS uq_events_dedupe
  ON shipment_tracking_events(
    shipment_id,
    COALESCE(external_event_id, ''),
    COALESCE(external_status_code, ''),
    COALESCE(event_occurred_at, 'epoch'::timestamptz)
  );
