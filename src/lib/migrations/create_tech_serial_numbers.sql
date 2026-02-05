-- Migration: Create tech_serial_numbers table
-- Purpose: Track individual serial numbers with types (SERIAL, FNSKU, SKU_STATIC)
-- Date: 2026-02-05

-- Create tech_serial_numbers table
CREATE TABLE IF NOT EXISTS tech_serial_numbers (
  id SERIAL PRIMARY KEY,
  shipping_tracking_number TEXT NOT NULL,
  serial_number TEXT NOT NULL,
  serial_type VARCHAR(20) NOT NULL DEFAULT 'SERIAL',
  test_date_time TIMESTAMP DEFAULT NOW(),
  tester_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create unique constraint to prevent duplicate serials on same tracking number
ALTER TABLE tech_serial_numbers 
  ADD CONSTRAINT tech_serial_numbers_unique 
  UNIQUE (shipping_tracking_number, serial_number);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tech_serial_shipping_tracking 
  ON tech_serial_numbers(shipping_tracking_number);

CREATE INDEX IF NOT EXISTS idx_tech_serial_type 
  ON tech_serial_numbers(serial_type);

CREATE INDEX IF NOT EXISTS idx_tech_serial_tester 
  ON tech_serial_numbers(tester_id);

CREATE INDEX IF NOT EXISTS idx_tech_serial_date 
  ON tech_serial_numbers(test_date_time);

-- Add comments for documentation
COMMENT ON TABLE tech_serial_numbers IS 
  'Individual serial numbers scanned by technicians with type tracking';

COMMENT ON COLUMN tech_serial_numbers.serial_type IS 
  'Type of serial: SERIAL (regular), FNSKU (X0 codes), SKU_STATIC (from sku table lookup)';

COMMENT ON COLUMN tech_serial_numbers.shipping_tracking_number IS 
  'Links to orders.shipping_tracking_number - can be regular tracking or FNSKU';

-- Add quantity column to orders if not exists
ALTER TABLE orders 
  ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1;

-- Add account_source column to orders if not exists (for FBA identification)
ALTER TABLE orders 
  ADD COLUMN IF NOT EXISTS account_source VARCHAR(50);

-- Add indexes to orders table
CREATE INDEX IF NOT EXISTS idx_orders_account_source 
  ON orders(account_source);

-- Add indexes to sku and sku_stock tables for faster lookups
CREATE INDEX IF NOT EXISTS idx_sku_static_sku 
  ON sku(static_sku);

CREATE INDEX IF NOT EXISTS idx_sku_stock_sku 
  ON sku_stock(sku);

-- Verify table was created
SELECT 
  table_name, 
  column_name, 
  data_type, 
  is_nullable
FROM information_schema.columns
WHERE table_name = 'tech_serial_numbers'
ORDER BY ordinal_position;
