-- Migration: Add shipping and testing columns to orders table
-- This consolidates the shipped table into orders table

ALTER TABLE orders ADD COLUMN IF NOT EXISTS serial_number TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tested_by TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS test_date_time TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS pack_date_time TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS packed_by TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_shipped BOOLEAN DEFAULT false;

-- Create index for faster filtering
CREATE INDEX IF NOT EXISTS idx_orders_is_shipped ON orders(is_shipped);
CREATE INDEX IF NOT EXISTS idx_orders_test_date_time ON orders(test_date_time);
