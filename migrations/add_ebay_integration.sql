-- eBay Multi-Account Integration Migration
-- Creates ebay_accounts table and adds eBay-specific columns to orders table

-- Create eBay accounts table
CREATE TABLE IF NOT EXISTS ebay_accounts (
    id SERIAL PRIMARY KEY,
    account_name VARCHAR(50) UNIQUE NOT NULL,
    ebay_user_id VARCHAR(100),
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expires_at TIMESTAMP NOT NULL,
    refresh_token_expires_at TIMESTAMP NOT NULL,
    marketplace_id VARCHAR(20) DEFAULT 'EBAY_US',
    last_sync_date TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Add eBay-specific columns to existing orders table (IF NOT EXISTS to prevent errors on re-run)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='account_source') THEN
        ALTER TABLE orders ADD COLUMN account_source VARCHAR(50);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='buyer_username') THEN
        ALTER TABLE orders ADD COLUMN buyer_username VARCHAR(100);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='buyer_email') THEN
        ALTER TABLE orders ADD COLUMN buyer_email VARCHAR(255);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='order_status') THEN
        ALTER TABLE orders ADD COLUMN order_status VARCHAR(50);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='order_date') THEN
        ALTER TABLE orders ADD COLUMN order_date TIMESTAMP;
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='raw_order_data') THEN
        ALTER TABLE orders ADD COLUMN raw_order_data JSONB;
    END IF;
END $$;

-- Create indexes for search performance
CREATE INDEX IF NOT EXISTS idx_orders_account_source ON orders(account_source);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_username ON orders(buyer_username);
CREATE INDEX IF NOT EXISTS idx_orders_order_date ON orders(order_date);

-- Create unique constraint on order_id and account_source combination
-- This prevents duplicate eBay orders while allowing same order_id from different sources
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_unique_account_order 
    ON orders(order_id, account_source) 
    WHERE account_source IS NOT NULL;

-- Insert the USAV eBay account with placeholder tokens (will be updated from env vars)
INSERT INTO ebay_accounts (account_name, access_token, refresh_token, token_expires_at, refresh_token_expires_at)
VALUES 
    ('USAV', 'placeholder', 'placeholder', NOW() + INTERVAL '2 hours', NOW() + INTERVAL '18 months')
ON CONFLICT (account_name) DO NOTHING;

-- Add comment to document the schema
COMMENT ON TABLE ebay_accounts IS 'Stores eBay account credentials and sync metadata for multi-account order management';
COMMENT ON COLUMN orders.account_source IS 'Identifies which eBay account or source this order came from (DRAGON, USAV, MEKONG, or null for non-eBay orders)';
