-- Migration: Migrate tester_id from orders to tech_serial_numbers
-- Purpose: Update existing tech_serial_numbers records with tester info from orders table
-- Date: 2026-02-05

BEGIN;

-- Step 1: For orders that have a tester_id set, update all their serials with that tester_id
-- (Only update if tech_serial_numbers.tester_id is NULL)
UPDATE tech_serial_numbers tsn
SET tester_id = o.tester_id
FROM orders o
WHERE tsn.shipping_tracking_number = o.shipping_tracking_number
  AND o.tester_id IS NOT NULL
  AND tsn.tester_id IS NULL;

-- Step 2: Report results
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO updated_count
  FROM tech_serial_numbers
  WHERE tester_id IS NOT NULL;
  
  RAISE NOTICE '';
  RAISE NOTICE '✅ Tester ID Migration Complete:';
  RAISE NOTICE '   Total serials with tester_id: %', updated_count;
  RAISE NOTICE '';
END $$;

-- Step 3: Show sample data
SELECT 
  'Sample Data After Migration' as info,
  tsn.shipping_tracking_number,
  tsn.serial_number,
  tsn.tester_id,
  s.name as tester_name,
  tsn.test_date_time
FROM tech_serial_numbers tsn
LEFT JOIN staff s ON tsn.tester_id = s.id
WHERE tsn.tester_id IS NOT NULL
ORDER BY tsn.test_date_time DESC NULLS LAST
LIMIT 5;

COMMIT;
