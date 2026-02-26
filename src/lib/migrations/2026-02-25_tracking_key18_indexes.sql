-- Migration: canonical tracking key-18 expression indexes and open-exception uniqueness
-- Purpose: accelerate key-18 lookup paths and prevent duplicate open exceptions per source station.

CREATE INDEX IF NOT EXISTS idx_orders_tracking_key18
ON orders (
  RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18)
);

CREATE INDEX IF NOT EXISTS idx_tech_serial_numbers_tracking_key18
ON tech_serial_numbers (
  RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18)
);

CREATE INDEX IF NOT EXISTS idx_packer_logs_tracking_key18
ON packer_logs (
  RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18)
);

CREATE INDEX IF NOT EXISTS idx_orders_exceptions_tracking_key18
ON orders_exceptions (
  RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_exceptions_open_source_key18
ON orders_exceptions (
  source_station,
  RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18)
)
WHERE status = 'open';
