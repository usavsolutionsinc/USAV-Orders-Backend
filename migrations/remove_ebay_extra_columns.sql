-- Remove extra eBay columns from orders table to keep it lean
-- Staff can view full details by clicking "View on eBay" button

DO $$ 
BEGIN
    -- Drop buyer_username column if it exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='buyer_username') THEN
        ALTER TABLE orders DROP COLUMN buyer_username;
        RAISE NOTICE 'Dropped buyer_username column';
    END IF;
    
    -- Drop buyer_email column if it exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='buyer_email') THEN
        ALTER TABLE orders DROP COLUMN buyer_email;
        RAISE NOTICE 'Dropped buyer_email column';
    END IF;
    
    -- Drop order_status column if it exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='order_status') THEN
        ALTER TABLE orders DROP COLUMN order_status;
        RAISE NOTICE 'Dropped order_status column';
    END IF;
    
    -- Drop raw_order_data column if it exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='raw_order_data') THEN
        ALTER TABLE orders DROP COLUMN raw_order_data;
        RAISE NOTICE 'Dropped raw_order_data column';
    END IF;
    
    -- Drop the buyer_username index if it exists
    IF EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_orders_buyer_username') THEN
        DROP INDEX idx_orders_buyer_username;
        RAISE NOTICE 'Dropped idx_orders_buyer_username index';
    END IF;
END $$;

-- Add comment
COMMENT ON COLUMN orders.account_source IS 'eBay account source (e.g., USAV). Staff can view full order details by clicking order_id link to open eBay page.';
