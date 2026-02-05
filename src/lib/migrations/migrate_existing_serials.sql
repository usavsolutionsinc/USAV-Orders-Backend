-- Migration: Copy existing serials from orders table to tech_serial_numbers
-- Purpose: Migrate comma-separated serial_number data to new table structure
-- Date: 2026-02-05

-- Step 1: Insert serials from orders table (split comma-separated values)
-- Use a CTE to first unnest the serials, then apply type detection
WITH split_serials AS (
  SELECT 
    o.shipping_tracking_number,
    TRIM(unnested_serial) as serial,
    o.account_source,
    o.test_date_time,
    o.tested_by
  FROM orders o,
  LATERAL UNNEST(STRING_TO_ARRAY(o.serial_number, ',')) as unnested_serial
  WHERE o.serial_number IS NOT NULL 
    AND o.serial_number != ''
    AND TRIM(o.serial_number) != ''
    AND o.shipping_tracking_number IS NOT NULL
    AND o.shipping_tracking_number != ''
    AND TRIM(o.shipping_tracking_number) != ''
)
INSERT INTO tech_serial_numbers (
  shipping_tracking_number,
  serial_number,
  serial_type,
  test_date_time,
  tester_id
)
SELECT 
  shipping_tracking_number,
  serial,
  CASE 
    -- Detect FNSKU if starts with X0 or B0
    WHEN serial ~* '^(X0|B0)' THEN 'FNSKU'
    -- Detect if order is FBA
    WHEN account_source = 'fba' THEN 'FNSKU'
    -- Default to SERIAL
    ELSE 'SERIAL'
  END as serial_type,
  CASE 
    -- Try to parse test_date_time if it's a string
    WHEN test_date_time IS NOT NULL AND test_date_time != '' THEN
      CASE 
        -- If contains '/', parse as M/D/YYYY H:MM:SS format
        WHEN test_date_time ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN
          TO_TIMESTAMP(test_date_time, 'MM/DD/YYYY HH24:MI:SS')
        -- If already timestamp-like, cast it
        ELSE 
          test_date_time::timestamp
      END
    ELSE NOW()
  END as test_date_time,
  tested_by
FROM split_serials
WHERE serial IS NOT NULL 
  AND serial != ''
ON CONFLICT (shipping_tracking_number, serial_number) 
DO NOTHING;  -- Skip duplicates if migration is run multiple times

-- Step 2: Report migration results
DO $$
DECLARE
  total_serials INTEGER;
  total_orders INTEGER;
  serial_types_count TEXT;
BEGIN
  -- Count migrated serials
  SELECT COUNT(*) INTO total_serials FROM tech_serial_numbers;
  
  -- Count orders with serials
  SELECT COUNT(DISTINCT shipping_tracking_number) INTO total_orders 
  FROM tech_serial_numbers;
  
  RAISE NOTICE '';
  RAISE NOTICE '✅ Migration Summary:';
  RAISE NOTICE '   Total serials migrated: %', total_serials;
  RAISE NOTICE '   Total orders with serials: %', total_orders;
  RAISE NOTICE '';
  
  -- Show breakdown by serial type
  FOR serial_types_count IN 
    SELECT serial_type || ': ' || COUNT(*) 
    FROM tech_serial_numbers 
    GROUP BY serial_type
  LOOP
    RAISE NOTICE '   %', serial_types_count;
  END LOOP;
  
  RAISE NOTICE '';
END $$;

-- Step 3: Verify sample data
SELECT 
  'Sample Data' as info,
  shipping_tracking_number,
  serial_number,
  serial_type,
  test_date_time
FROM tech_serial_numbers
ORDER BY test_date_time DESC
LIMIT 5;
