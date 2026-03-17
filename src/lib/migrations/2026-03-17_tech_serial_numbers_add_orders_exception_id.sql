BEGIN;

ALTER TABLE tech_serial_numbers
  ADD COLUMN IF NOT EXISTS orders_exception_id INTEGER REFERENCES orders_exceptions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tech_serial_numbers_orders_exception_id
  ON tech_serial_numbers(orders_exception_id)
  WHERE orders_exception_id IS NOT NULL;

COMMIT;
