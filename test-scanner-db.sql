-- Tech Scanner Database Verification Script
-- Run this to verify database schema and test data

-- 1. Check if orders table has required columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'orders'
  AND column_name IN (
    'id',
    'shipping_tracking_number',
    'serial_number',
    'test_date_time',
    'tested_by',
    'product_title',
    'sku',
    'condition',
    'notes',
    'order_id',
    'status_history'
  )
ORDER BY column_name;

-- 2. Check if staff table exists and has tech members
SELECT id, name, role, employee_id, active
FROM staff
WHERE role = 'technician'
  AND active = true
ORDER BY id;

-- 3. Find orders with tracking numbers (test candidates)
SELECT 
    id,
    order_id,
    product_title,
    shipping_tracking_number,
    serial_number,
    test_date_time,
    tested_by,
    CASE 
        WHEN serial_number IS NOT NULL AND serial_number != '' 
        THEN array_length(string_to_array(serial_number, ','), 1)
        ELSE 0
    END as serial_count
FROM orders
WHERE shipping_tracking_number IS NOT NULL
  AND shipping_tracking_number != ''
ORDER BY id DESC
LIMIT 10;

-- 4. Check orders with existing serials (for re-scan testing)
SELECT 
    id,
    shipping_tracking_number,
    serial_number,
    test_date_time,
    tested_by,
    product_title
FROM orders
WHERE serial_number IS NOT NULL
  AND serial_number != ''
ORDER BY test_date_time DESC
LIMIT 5;

-- 5. View status history for orders with serials
SELECT 
    id,
    shipping_tracking_number,
    jsonb_pretty(status_history) as history
FROM orders
WHERE status_history IS NOT NULL
  AND jsonb_array_length(status_history) > 0
ORDER BY id DESC
LIMIT 3;

-- 6. Sample tracking numbers for testing (last 8 digits)
SELECT 
    RIGHT(shipping_tracking_number, 8) as last_8_digits,
    shipping_tracking_number as full_tracking,
    product_title,
    serial_number
FROM orders
WHERE shipping_tracking_number IS NOT NULL
  AND shipping_tracking_number != ''
LIMIT 5;

-- Optional: Create test order if needed
-- Uncomment and run if you need a test order:
/*
INSERT INTO orders (
    order_id,
    product_title,
    sku,
    condition,
    shipping_tracking_number,
    notes
) VALUES (
    'TEST-ORD-001',
    'TEST PRODUCT - Sony Camera',
    'TEST-SKU-001',
    'Used - Excellent',
    '1Z999AA10123456784',
    'This is a test order for scanner verification'
)
RETURNING id, shipping_tracking_number;
*/

-- Check tech ID mappings (for API route)
-- These should match the techEmployeeIds in the API routes
SELECT 
    id as staff_id,
    name,
    employee_id,
    role
FROM staff
WHERE employee_id IN ('TECH001', 'TECH002', 'TECH003', 'TECH004')
ORDER BY employee_id;
