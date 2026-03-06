-- Migration: Ensure orders table has all required columns
-- Date: 2026-03-06

BEGIN;

-- Core identifiers
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_id                TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS item_number             TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id             INTEGER REFERENCES customers(id) ON DELETE SET NULL;

-- Product info
ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_title           TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sku                     TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS condition               TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS quantity                TEXT DEFAULT '1';

-- Shipping
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_tracking_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_shipped              BOOLEAN NOT NULL DEFAULT false;

-- Status
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status                  TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS status_history          JSONB DEFAULT '[]';

-- Dates
ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_date              TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS ship_by_date            TIMESTAMP;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- Misc
ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes                   TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS out_of_stock            TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS account_source          TEXT;

-- Indexes for common lookups
CREATE INDEX IF NOT EXISTS idx_orders_order_id         ON orders(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id      ON orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status           ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_ship_by_date     ON orders(ship_by_date);

DO $$
BEGIN
  RAISE NOTICE 'orders table columns verified / added successfully.';
END $$;

COMMIT;
