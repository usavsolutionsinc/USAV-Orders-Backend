-- Migration: create orders_exceptions hold-bucket table for unmatched tracking scans

CREATE TABLE IF NOT EXISTS orders_exceptions (
  id SERIAL PRIMARY KEY,
  shipping_tracking_number TEXT NOT NULL,
  source_station VARCHAR(20) NOT NULL,
  staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  staff_name TEXT,
  exception_reason VARCHAR(50) NOT NULL DEFAULT 'not_found',
  notes TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_exceptions_status ON orders_exceptions(status);
CREATE INDEX IF NOT EXISTS idx_orders_exceptions_tracking ON orders_exceptions(shipping_tracking_number);
CREATE INDEX IF NOT EXISTS idx_orders_exceptions_source_status ON orders_exceptions(source_station, status);
