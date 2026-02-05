-- Migration: Remove overlapping columns from orders table
-- Purpose: Clean up redundant columns now tracked in tech_serial_numbers
-- Date: 2026-02-05

-- Columns to remove:
-- 1. serial_number - Now tracked individually in tech_serial_numbers
-- 2. test_date_time - Now tracked per-serial in tech_serial_numbers
-- 3. tested_by - Now tracked per-serial as tester_id in tech_serial_numbers

-- Note: We keep tester_id in orders (for assignment tracking)

BEGIN;

-- Step 1: Backup comment for reference
COMMENT ON TABLE orders IS 'Orders table - cleaned up 2026-02-05. Serial tracking moved to tech_serial_numbers table.';

-- Step 2: Drop test_date_time column
ALTER TABLE orders DROP COLUMN IF EXISTS test_date_time;
COMMENT ON TABLE orders IS 'test_date_time removed - now derived from tech_serial_numbers.test_date_time (MIN for first scan)';

-- Step 3: Drop tested_by column
ALTER TABLE orders DROP COLUMN IF EXISTS tested_by;
COMMENT ON TABLE orders IS 'tested_by removed - now tracked per-serial in tech_serial_numbers.tester_id';

-- Step 4: Drop serial_number column
ALTER TABLE orders DROP COLUMN IF EXISTS serial_number;
COMMENT ON TABLE orders IS 'serial_number removed - now tracked individually in tech_serial_numbers table';

-- Step 5: Create indexes for common join patterns
CREATE INDEX IF NOT EXISTS idx_orders_shipping_tracking 
  ON orders(shipping_tracking_number);

CREATE INDEX IF NOT EXISTS idx_orders_tester_id 
  ON orders(tester_id);

-- Step 6: Report cleanup results
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Orders Table Cleanup Complete:';
  RAISE NOTICE '   ❌ Removed: test_date_time';
  RAISE NOTICE '   ❌ Removed: tested_by';
  RAISE NOTICE '   ❌ Removed: serial_number';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Kept in orders table:';
  RAISE NOTICE '   ✓ shipping_tracking_number (join key)';
  RAISE NOTICE '   ✓ tester_id (assignment tracking)';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Serial tracking now in tech_serial_numbers:';
  RAISE NOTICE '   ✓ shipping_tracking_number (join to orders)';
  RAISE NOTICE '   ✓ serial_number (individual serials)';
  RAISE NOTICE '   ✓ test_date_time (per-serial timestamp)';
  RAISE NOTICE '   ✓ tester_id (who scanned this serial)';
  RAISE NOTICE '';
END $$;

COMMIT;

-- Verification query: Show combined data from both tables
SELECT 
  'Sample Combined Data' as info,
  o.order_id,
  o.shipping_tracking_number,
  o.product_title,
  tsn.serial_number,
  tsn.serial_type,
  tsn.test_date_time,
  s.name as tester_name
FROM orders o
LEFT JOIN tech_serial_numbers tsn ON o.shipping_tracking_number = tsn.shipping_tracking_number
LEFT JOIN staff s ON tsn.tester_id = s.id
WHERE tsn.serial_number IS NOT NULL
ORDER BY tsn.test_date_time DESC
LIMIT 5;
