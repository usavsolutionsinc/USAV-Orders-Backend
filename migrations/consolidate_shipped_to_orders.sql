-- Migration: Consolidate Shipped Table into Orders Table
-- Date: 2026-02-02
-- Description: Add shipping-related columns to orders table to eliminate the need for a separate shipped table

-- Add new columns to orders table (if they don't already exist)
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS serial_number TEXT,
ADD COLUMN IF NOT EXISTS tested_by TEXT,
ADD COLUMN IF NOT EXISTS test_date_time TEXT,
ADD COLUMN IF NOT EXISTS pack_date_time TEXT,
ADD COLUMN IF NOT EXISTS packed_by TEXT,
ADD COLUMN IF NOT EXISTS is_shipped BOOLEAN DEFAULT false;

-- Create index on is_shipped for faster queries
CREATE INDEX IF NOT EXISTS idx_orders_is_shipped ON orders(is_shipped);

-- Create index on test_date_time for tech queue filtering
CREATE INDEX IF NOT EXISTS idx_orders_test_date_time ON orders(test_date_time);

-- NOTES:
-- 1. The shipped table is now DEPRECATED and should no longer be used
-- 2. All "shipped" functionality now queries: orders WHERE is_shipped = true
-- 3. Tech workflow updates: serial_number, tested_by, test_date_time in orders table
-- 4. Packer workflow updates: packed_by, pack_date_time, is_shipped = true in orders table
-- 5. Tech queue filtering: (test_date_time IS NULL OR test_date_time = '') AND is_shipped = false
-- 6. Single source of truth: orders table

-- TO DEPRECATE (after confirming all workflows work):
-- DROP TABLE IF EXISTS shipped CASCADE;
