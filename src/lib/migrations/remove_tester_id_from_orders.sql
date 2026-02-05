-- Migration: Remove tester_id column from orders table
-- Purpose: Clean up redundant column now that testing data is in tech_serial_numbers
-- Date: 2026-02-05

-- Note: tester_id in orders table was used for assignment tracking
-- All actual test completion data is now in tech_serial_numbers.tester_id

BEGIN;

-- Step 1: Verify tech_serial_numbers has tester data
DO $$
DECLARE
  serials_with_tester INTEGER;
  total_serials INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_serials FROM tech_serial_numbers;
  SELECT COUNT(*) INTO serials_with_tester 
  FROM tech_serial_numbers 
  WHERE tester_id IS NOT NULL;
  
  RAISE NOTICE '';
  RAISE NOTICE '📊 Pre-migration check:';
  RAISE NOTICE '   Total serials in tech_serial_numbers: %', total_serials;
  RAISE NOTICE '   Serials with tester_id: %', serials_with_tester;
  RAISE NOTICE '';
  
  IF serials_with_tester < total_serials THEN
    RAISE WARNING '⚠️  Some serials missing tester_id. Consider syncing from Google Sheets first.';
  ELSE
    RAISE NOTICE '✅ All serials have tester_id set. Safe to proceed.';
  END IF;
END $$;

-- Step 2: Drop tester_id column from orders table
ALTER TABLE orders DROP COLUMN IF EXISTS tester_id;

COMMENT ON TABLE orders IS 'Orders table - tester_id removed 2026-02-05. Test tracking now in tech_serial_numbers table.';

-- Step 3: Report results
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '✅ Migration Complete:';
  RAISE NOTICE '   ❌ Removed: orders.tester_id';
  RAISE NOTICE '   ✅ Test tracking: tech_serial_numbers.tester_id';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Orders table now contains:';
  RAISE NOTICE '   - Order metadata (id, order_id, product_title, etc.)';
  RAISE NOTICE '   - Packing data (packed_by, pack_date_time)';
  RAISE NOTICE '   - Shipping data (shipping_tracking_number, is_shipped)';
  RAISE NOTICE '';
  RAISE NOTICE '✅ Tech serial numbers table contains:';
  RAISE NOTICE '   - Serial data (serial_number, serial_type)';
  RAISE NOTICE '   - Test tracking (tester_id, test_date_time)';
  RAISE NOTICE '';
END $$;

-- Step 4: Verify column is removed
SELECT 
  'Verification' as info,
  CASE 
    WHEN COUNT(*) = 0 THEN '✅ tester_id successfully removed from orders table'
    ELSE '❌ tester_id still exists in orders table'
  END as result
FROM information_schema.columns
WHERE table_name = 'orders' AND column_name = 'tester_id';

COMMIT;
