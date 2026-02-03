-- Migration: Consolidate Tech and Packer Table Data into Orders
-- Purpose: Migrate completed order data from tech_1-3 and packer_1-2 into orders table
--          with proper foreign key relationships to staff table

BEGIN;

-- =============================================================================
-- STEP 1: Add source_table and status_history columns
-- =============================================================================
DO $$
BEGIN
    RAISE NOTICE '=== STEP 1: Updating Table Structure ===';
    
    -- Add source_table column to staff if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'staff' AND column_name = 'source_table'
    ) THEN
        ALTER TABLE staff ADD COLUMN source_table TEXT;
        RAISE NOTICE '✓ Added source_table column to staff table';
    ELSE
        RAISE NOTICE '✓ source_table column already exists';
    END IF;
    
    -- Add status_history column to orders if it doesn't exist
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'orders' AND column_name = 'status_history'
    ) THEN
        ALTER TABLE orders ADD COLUMN status_history JSONB DEFAULT '[]'::jsonb;
        RAISE NOTICE '✓ Added status_history column to orders table';
    ELSE
        RAISE NOTICE '✓ status_history column already exists';
    END IF;
END $$;

-- Update staff records with source table mappings
UPDATE staff SET source_table = 'tech_1' WHERE employee_id = 'TECH001';
UPDATE staff SET source_table = 'tech_2' WHERE employee_id = 'TECH002';
UPDATE staff SET source_table = 'tech_3' WHERE employee_id = 'TECH003';
UPDATE staff SET source_table = 'packer_1' WHERE employee_id = 'PACK001';
UPDATE staff SET source_table = 'packer_2' WHERE employee_id = 'PACK002';

DO $$ 
BEGIN 
    RAISE NOTICE '✓ Updated staff records with source_table mappings'; 
END $$;

-- =============================================================================
-- STEP 2: Add Foreign Key Constraints to Orders Table
-- =============================================================================
DO $$
BEGIN
    RAISE NOTICE '=== STEP 2: Adding Foreign Key Constraints ===';
    
    -- FK for tested_by (who completed testing)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_orders_tested_by' AND table_name = 'orders'
    ) THEN
        ALTER TABLE orders 
            ADD CONSTRAINT fk_orders_tested_by 
            FOREIGN KEY (tested_by) 
            REFERENCES staff(id) 
            ON DELETE SET NULL;
        RAISE NOTICE '✓ Added FK constraint: orders.tested_by → staff.id';
    ELSE
        RAISE NOTICE '✓ FK constraint fk_orders_tested_by already exists';
    END IF;
    
    -- FK for packed_by (who completed packing)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_orders_packed_by' AND table_name = 'orders'
    ) THEN
        ALTER TABLE orders 
            ADD CONSTRAINT fk_orders_packed_by 
            FOREIGN KEY (packed_by) 
            REFERENCES staff(id) 
            ON DELETE SET NULL;
        RAISE NOTICE '✓ Added FK constraint: orders.packed_by → staff.id';
    ELSE
        RAISE NOTICE '✓ FK constraint fk_orders_packed_by already exists';
    END IF;
    
    -- FK for tester_id (who is assigned to test)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_orders_tester_id' AND table_name = 'orders'
    ) THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'orders' AND column_name = 'tester_id'
        ) THEN
            ALTER TABLE orders 
                ADD CONSTRAINT fk_orders_tester_id 
                FOREIGN KEY (tester_id) 
                REFERENCES staff(id) 
                ON DELETE SET NULL;
            RAISE NOTICE '✓ Added FK constraint: orders.tester_id → staff.id';
        ELSE
            RAISE NOTICE '⚠ Column tester_id does not exist, skipping FK';
        END IF;
    ELSE
        RAISE NOTICE '✓ FK constraint fk_orders_tester_id already exists';
    END IF;
    
    -- FK for packer_id (who is assigned to pack)
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'fk_orders_packer_id' AND table_name = 'orders'
    ) THEN
        IF EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'orders' AND column_name = 'packer_id'
        ) THEN
            ALTER TABLE orders 
                ADD CONSTRAINT fk_orders_packer_id 
                FOREIGN KEY (packer_id) 
                REFERENCES staff(id) 
                ON DELETE SET NULL;
            RAISE NOTICE '✓ Added FK constraint: orders.packer_id → staff.id';
        ELSE
            RAISE NOTICE '⚠ Column packer_id does not exist, skipping FK';
        END IF;
    ELSE
        RAISE NOTICE '✓ FK constraint fk_orders_packer_id already exists';
    END IF;
END $$;

-- =============================================================================
-- STEP 3: Pre-Migration Statistics
-- =============================================================================
DO $$
DECLARE
    tech1_count INT;
    tech2_count INT;
    tech3_count INT;
    packer1_count INT;
    packer2_count INT;
    orders_tested_before INT;
    orders_packed_before INT;
BEGIN
    RAISE NOTICE '=== STEP 3: Pre-Migration Statistics ===';
    
    -- Count tech table records (excluding X00)
    SELECT COUNT(*) INTO tech1_count FROM tech_1 
    WHERE shipping_tracking_number NOT LIKE 'X00%' 
        AND shipping_tracking_number IS NOT NULL 
        AND shipping_tracking_number != ''
        AND date_time IS NOT NULL 
        AND date_time != '';
    
    SELECT COUNT(*) INTO tech2_count FROM tech_2 
    WHERE shipping_tracking_number NOT LIKE 'X00%' 
        AND shipping_tracking_number IS NOT NULL 
        AND shipping_tracking_number != ''
        AND date_time IS NOT NULL 
        AND date_time != '';
    
    SELECT COUNT(*) INTO tech3_count FROM tech_3 
    WHERE shipping_tracking_number NOT LIKE 'X00%' 
        AND shipping_tracking_number IS NOT NULL 
        AND shipping_tracking_number != ''
        AND date_time IS NOT NULL 
        AND date_time != '';
    
    -- Count packer table records (excluding X00)
    SELECT COUNT(*) INTO packer1_count FROM packer_1 
    WHERE shipping_tracking_number NOT LIKE 'X00%' 
        AND shipping_tracking_number IS NOT NULL 
        AND shipping_tracking_number != ''
        AND date_time IS NOT NULL 
        AND date_time != '';
    
    SELECT COUNT(*) INTO packer2_count FROM packer_2 
    WHERE shipping_tracking_number NOT LIKE 'X00%' 
        AND shipping_tracking_number IS NOT NULL 
        AND shipping_tracking_number != ''
        AND date_time IS NOT NULL 
        AND date_time != '';
    
    -- Count existing populated orders
    SELECT COUNT(*) INTO orders_tested_before FROM orders WHERE tested_by IS NOT NULL;
    SELECT COUNT(*) INTO orders_packed_before FROM orders WHERE packed_by IS NOT NULL;
    
    RAISE NOTICE 'Tech Records to Migrate:';
    RAISE NOTICE '  - tech_1 (Michael): % records', tech1_count;
    RAISE NOTICE '  - tech_2 (Thuc): % records', tech2_count;
    RAISE NOTICE '  - tech_3 (Sang): % records', tech3_count;
    RAISE NOTICE 'Packer Records to Migrate:';
    RAISE NOTICE '  - packer_1 (Tuan): % records', packer1_count;
    RAISE NOTICE '  - packer_2 (Thuy): % records', packer2_count;
    RAISE NOTICE 'Current Orders Table:';
    RAISE NOTICE '  - Orders with tested_by: %', orders_tested_before;
    RAISE NOTICE '  - Orders with packed_by: %', orders_packed_before;
END $$;

-- =============================================================================
-- STEP 4: Migrate Tech Table Data (tech_1, tech_2, tech_3)
-- =============================================================================
DO $$
DECLARE
    michael_id INT;
    thuc_id INT;
    sang_id INT;
    tech1_updated INT;
    tech2_updated INT;
    tech3_updated INT;
BEGIN
    RAISE NOTICE '=== STEP 4: Migrating Tech Table Data ===';
    
    -- Get staff IDs
    SELECT id INTO michael_id FROM staff WHERE employee_id = 'TECH001';
    SELECT id INTO thuc_id FROM staff WHERE employee_id = 'TECH002';
    SELECT id INTO sang_id FROM staff WHERE employee_id = 'TECH003';
    
    IF michael_id IS NULL OR thuc_id IS NULL OR sang_id IS NULL THEN
        RAISE EXCEPTION 'Staff records not found. Expected TECH001, TECH002, TECH003';
    END IF;
    
    RAISE NOTICE 'Staff IDs: Michael=%, Thuc=%, Sang=%', michael_id, thuc_id, sang_id;
    
    -- Migrate tech_1 → Michael
    WITH updated AS (
        UPDATE orders o
        SET 
            tested_by = michael_id,
            test_date_time = t.date_time,
            status_history = COALESCE(o.status_history, '[]'::jsonb) || 
                jsonb_build_object(
                    'status', 'tested',
                    'timestamp', CASE 
                        WHEN t.date_time ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN
                            to_timestamp(t.date_time, 'MM/DD/YYYY HH24:MI:SS')::text
                        ELSE t.date_time
                    END,
                    'user', 'Michael',
                    'previous_status', COALESCE(
                        (o.status_history->-1->>'status')::text,
                        null
                    )
                )::jsonb
        FROM tech_1 t
        WHERE o.shipping_tracking_number = t.shipping_tracking_number
            AND t.shipping_tracking_number NOT LIKE 'X00%'
            AND t.shipping_tracking_number IS NOT NULL
            AND t.shipping_tracking_number != ''
            AND t.date_time IS NOT NULL
            AND t.date_time != ''
        RETURNING o.id
    )
    SELECT COUNT(*) INTO tech1_updated FROM updated;
    
    RAISE NOTICE '✓ Migrated % orders from tech_1 (Michael) with status_history', tech1_updated;
    
    -- Migrate tech_2 → Thuc
    WITH updated AS (
        UPDATE orders o
        SET 
            tested_by = thuc_id,
            test_date_time = t.date_time,
            status_history = COALESCE(o.status_history, '[]'::jsonb) || 
                jsonb_build_object(
                    'status', 'tested',
                    'timestamp', CASE 
                        WHEN t.date_time ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN
                            to_timestamp(t.date_time, 'MM/DD/YYYY HH24:MI:SS')::text
                        ELSE t.date_time
                    END,
                    'user', 'Thuc',
                    'previous_status', COALESCE(
                        (o.status_history->-1->>'status')::text,
                        null
                    )
                )::jsonb
        FROM tech_2 t
        WHERE o.shipping_tracking_number = t.shipping_tracking_number
            AND t.shipping_tracking_number NOT LIKE 'X00%'
            AND t.shipping_tracking_number IS NOT NULL
            AND t.shipping_tracking_number != ''
            AND t.date_time IS NOT NULL
            AND t.date_time != ''
        RETURNING o.id
    )
    SELECT COUNT(*) INTO tech2_updated FROM updated;
    
    RAISE NOTICE '✓ Migrated % orders from tech_2 (Thuc) with status_history', tech2_updated;
    
    -- Migrate tech_3 → Sang
    WITH updated AS (
        UPDATE orders o
        SET 
            tested_by = sang_id,
            test_date_time = t.date_time,
            status_history = COALESCE(o.status_history, '[]'::jsonb) || 
                jsonb_build_object(
                    'status', 'tested',
                    'timestamp', CASE 
                        WHEN t.date_time ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN
                            to_timestamp(t.date_time, 'MM/DD/YYYY HH24:MI:SS')::text
                        ELSE t.date_time
                    END,
                    'user', 'Sang',
                    'previous_status', COALESCE(
                        (o.status_history->-1->>'status')::text,
                        null
                    )
                )::jsonb
        FROM tech_3 t
        WHERE o.shipping_tracking_number = t.shipping_tracking_number
            AND t.shipping_tracking_number NOT LIKE 'X00%'
            AND t.shipping_tracking_number IS NOT NULL
            AND t.shipping_tracking_number != ''
            AND t.date_time IS NOT NULL
            AND t.date_time != ''
        RETURNING o.id
    )
    SELECT COUNT(*) INTO tech3_updated FROM updated;
    
    RAISE NOTICE '✓ Migrated % orders from tech_3 (Sang) with status_history', tech3_updated;
    RAISE NOTICE 'Total tech records migrated: %', tech1_updated + tech2_updated + tech3_updated;
END $$;

-- =============================================================================
-- STEP 5: Migrate Packer Table Data (packer_1, packer_2)
-- =============================================================================
DO $$
DECLARE
    tuan_id INT;
    thuy_id INT;
    packer1_updated INT;
    packer2_updated INT;
BEGIN
    RAISE NOTICE '=== STEP 5: Migrating Packer Table Data ===';
    
    -- Get staff IDs
    SELECT id INTO tuan_id FROM staff WHERE employee_id = 'PACK001';
    SELECT id INTO thuy_id FROM staff WHERE employee_id = 'PACK002';
    
    IF tuan_id IS NULL OR thuy_id IS NULL THEN
        RAISE EXCEPTION 'Staff records not found. Expected PACK001, PACK002';
    END IF;
    
    RAISE NOTICE 'Staff IDs: Tuan=%, Thuy=%', tuan_id, thuy_id;
    
    -- Migrate packer_1 → Tuan
    WITH updated AS (
        UPDATE orders o
        SET 
            packed_by = tuan_id,
            pack_date_time = p.date_time,
            is_shipped = true,
            status_history = COALESCE(o.status_history, '[]'::jsonb) || 
                jsonb_build_object(
                    'status', 'packed',
                    'timestamp', CASE 
                        WHEN p.date_time ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN
                            to_timestamp(p.date_time, 'MM/DD/YYYY HH24:MI:SS')::text
                        ELSE p.date_time
                    END,
                    'user', 'Tuan',
                    'previous_status', COALESCE(
                        (o.status_history->-1->>'status')::text,
                        null
                    )
                )::jsonb
        FROM packer_1 p
        WHERE o.shipping_tracking_number = p.shipping_tracking_number
            AND p.shipping_tracking_number NOT LIKE 'X00%'
            AND p.shipping_tracking_number IS NOT NULL
            AND p.shipping_tracking_number != ''
            AND p.date_time IS NOT NULL
            AND p.date_time != ''
        RETURNING o.id
    )
    SELECT COUNT(*) INTO packer1_updated FROM updated;
    
    RAISE NOTICE '✓ Migrated % orders from packer_1 (Tuan) with status_history + is_shipped', packer1_updated;
    
    -- Migrate packer_2 → Thuy
    WITH updated AS (
        UPDATE orders o
        SET 
            packed_by = thuy_id,
            pack_date_time = p.date_time,
            is_shipped = true,
            status_history = COALESCE(o.status_history, '[]'::jsonb) || 
                jsonb_build_object(
                    'status', 'packed',
                    'timestamp', CASE 
                        WHEN p.date_time ~ '^\d{1,2}/\d{1,2}/\d{4}' THEN
                            to_timestamp(p.date_time, 'MM/DD/YYYY HH24:MI:SS')::text
                        ELSE p.date_time
                    END,
                    'user', 'Thuy',
                    'previous_status', COALESCE(
                        (o.status_history->-1->>'status')::text,
                        null
                    )
                )::jsonb
        FROM packer_2 p
        WHERE o.shipping_tracking_number = p.shipping_tracking_number
            AND p.shipping_tracking_number NOT LIKE 'X00%'
            AND p.shipping_tracking_number IS NOT NULL
            AND p.shipping_tracking_number != ''
            AND p.date_time IS NOT NULL
            AND p.date_time != ''
        RETURNING o.id
    )
    SELECT COUNT(*) INTO packer2_updated FROM updated;
    
    RAISE NOTICE '✓ Migrated % orders from packer_2 (Thuy) with status_history + is_shipped', packer2_updated;
    RAISE NOTICE 'Total packer records migrated: %', packer1_updated + packer2_updated;
END $$;

-- =============================================================================
-- STEP 6: Post-Migration Validation
-- =============================================================================
DO $$
DECLARE
    orders_tested_after INT;
    orders_packed_after INT;
    fk_test_count INT;
    fk_pack_count INT;
BEGIN
    RAISE NOTICE '=== STEP 6: Post-Migration Validation ===';
    
    -- Count populated orders
    SELECT COUNT(*) INTO orders_tested_after FROM orders WHERE tested_by IS NOT NULL;
    SELECT COUNT(*) INTO orders_packed_after FROM orders WHERE packed_by IS NOT NULL;
    
    -- Verify FK integrity
    SELECT COUNT(*) INTO fk_test_count 
    FROM orders o 
    INNER JOIN staff s ON o.tested_by = s.id 
    WHERE o.tested_by IS NOT NULL;
    
    SELECT COUNT(*) INTO fk_pack_count 
    FROM orders o 
    INNER JOIN staff s ON o.packed_by = s.id 
    WHERE o.packed_by IS NOT NULL;
    
    RAISE NOTICE 'Post-Migration Statistics:';
    RAISE NOTICE '  - Orders with tested_by: %', orders_tested_after;
    RAISE NOTICE '  - Orders with packed_by: %', orders_packed_after;
    RAISE NOTICE '  - Verified tested_by FK integrity: %', fk_test_count;
    RAISE NOTICE '  - Verified packed_by FK integrity: %', fk_pack_count;
    
    IF fk_test_count = orders_tested_after AND fk_pack_count = orders_packed_after THEN
        RAISE NOTICE '✓ All foreign key relationships validated successfully!';
    ELSE
        RAISE WARNING '⚠ Some FK relationships may have issues';
    END IF;
END $$;

-- Sample data verification
DO $$
DECLARE
    sample_record RECORD;
    sample_count INT := 0;
BEGIN
    RAISE NOTICE '=== Sample Migrated Records ===';
    
    FOR sample_record IN (
        SELECT 
            o.id,
            o.shipping_tracking_number,
            s1.name as tested_by_name,
            s1.employee_id as tested_by_emp_id,
            o.test_date_time,
            s2.name as packed_by_name,
            s2.employee_id as packed_by_emp_id,
            o.pack_date_time
        FROM orders o
        LEFT JOIN staff s1 ON o.tested_by = s1.id
        LEFT JOIN staff s2 ON o.packed_by = s2.id
        WHERE (o.tested_by IS NOT NULL OR o.packed_by IS NOT NULL)
        ORDER BY o.id DESC
        LIMIT 5
    ) LOOP
        sample_count := sample_count + 1;
        RAISE NOTICE 'Order #%: tracking=%, tested_by=% (%), packed_by=% (%)', 
            sample_record.id, 
            sample_record.shipping_tracking_number,
            sample_record.tested_by_name,
            sample_record.tested_by_emp_id,
            sample_record.packed_by_name,
            sample_record.packed_by_emp_id;
    END LOOP;
    
    IF sample_count = 0 THEN
        RAISE NOTICE 'No migrated records found in orders table';
    END IF;
END $$;

COMMIT;

DO $$ 
BEGIN 
    RAISE NOTICE '=== Migration Complete! ===';
    RAISE NOTICE 'All changes have been committed successfully.';
END $$;
