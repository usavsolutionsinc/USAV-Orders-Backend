-- Source of Truth Database Schema
-- This schema mirrors Google Sheets structure for USAV Orders Backend
-- Created: January 5, 2026

-- Drop tables if they exist (use with caution!)
-- DROP TABLE IF EXISTS orders CASCADE;
-- DROP TABLE IF EXISTS tech_1, tech_2, tech_3, tech_4 CASCADE;
-- DROP TABLE IF EXISTS packer_1, packer_2, packer_3 CASCADE;
-- DROP TABLE IF EXISTS receiving, shipped, sku_stock, sku, rs CASCADE;

-- 1. ORDERS TABLE
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    ship_by_date TEXT,
    order_id TEXT,
    product_title TEXT,
    quantity TEXT,
    sku TEXT,
    condition TEXT,
    shipping_tracking_number TEXT,
    days_late TEXT,
    out_of_stock TEXT,
    notes TEXT,
    assigned_to TEXT,
    status TEXT NOT NULL DEFAULT 'unassigned',
    urgent TEXT
);

-- 2. TECH_1 TABLE (7 columns)
CREATE TABLE IF NOT EXISTS tech_1 (
    id SERIAL PRIMARY KEY,
    date_time TEXT,
    product_title TEXT,
    shipping_tracking_number TEXT,
    serial_number TEXT,
    condition TEXT,
    quantity TEXT
);

-- 3. TECH_2 TABLE (7 columns)
CREATE TABLE IF NOT EXISTS tech_2 (
    id SERIAL PRIMARY KEY,
    date_time TEXT,
    product_title TEXT,
    shipping_tracking_number TEXT,
    serial_number TEXT,
    condition TEXT,
    quantity TEXT
);

-- 4. TECH_3 TABLE (7 columns)
CREATE TABLE IF NOT EXISTS tech_3 (
    id SERIAL PRIMARY KEY,
    date_time TEXT,
    product_title TEXT,
    shipping_tracking_number TEXT,
    serial_number TEXT,
    condition TEXT,
    quantity TEXT
);

-- 5. TECH_4 TABLE (7 columns)
CREATE TABLE IF NOT EXISTS tech_4 (
    id SERIAL PRIMARY KEY,
    date_time TEXT,
    product_title TEXT,
    shipping_tracking_number TEXT,
    serial_number TEXT,
    condition TEXT,
    quantity TEXT
);

-- 6. PACKER_1 TABLE (6 columns)
CREATE TABLE IF NOT EXISTS packer_1 (
    id SERIAL PRIMARY KEY,
    date_time TEXT,
    shipping_tracking_number TEXT,
    carrier TEXT,
    product_title TEXT,
    quantity TEXT
);

-- 7. PACKER_2 TABLE (6 columns)
CREATE TABLE IF NOT EXISTS packer_2 (
    id SERIAL PRIMARY KEY,
    date_time TEXT,
    shipping_tracking_number TEXT,
    carrier TEXT,
    product_title TEXT,
    quantity TEXT
);

-- 8. PACKER_3 TABLE (6 columns)
CREATE TABLE IF NOT EXISTS packer_3 (
    id SERIAL PRIMARY KEY,
    date_time TEXT,
    shipping_tracking_number TEXT,
    carrier TEXT,
    product_title TEXT,
    quantity TEXT
);

-- 9. RECEIVING TABLE
CREATE TABLE IF NOT EXISTS receiving (
    id SERIAL PRIMARY KEY,
    date_time TEXT,
    receiving_tracking_number TEXT,
    carrier TEXT,
    quantity TEXT
);

-- 10. SHIPPED TABLE (13 columns)
CREATE TABLE IF NOT EXISTS shipped (
    id SERIAL PRIMARY KEY,
    date_time TEXT,
    order_id TEXT,
    product_title TEXT,
    condition TEXT,
    shipping_tracking_number TEXT,
    serial_number TEXT,
    packed_by TEXT,
    tested_by TEXT,
    sku TEXT,
    status TEXT DEFAULT 'pending',
    status_history JSONB DEFAULT '[]',
    test_date_time TEXT
);

-- 11. SKU_STOCK TABLE (5 columns)
CREATE TABLE IF NOT EXISTS sku_stock (
    id SERIAL PRIMARY KEY,
    stock TEXT,
    sku TEXT,
    size TEXT,
    product_title TEXT
);

-- 12. SKU TABLE
CREATE TABLE IF NOT EXISTS sku (
    id SERIAL PRIMARY KEY,
    date_time TEXT,
    static_sku TEXT,
    serial_number TEXT,
    shipping_tracking_number TEXT,
    product_title TEXT,
    notes TEXT,
    location TEXT
);

-- 13. REPAIR_SERVICE TABLE
CREATE TABLE IF NOT EXISTS repair_service (
    id SERIAL PRIMARY KEY,
    date_time TEXT,
    ticket_number TEXT,
    product_title TEXT,
    issue TEXT,
    serial_number TEXT,
    name TEXT,
    contact TEXT,
    price TEXT,
    status TEXT DEFAULT 'pending',
    repair_reasons TEXT,
    process TEXT
);

-- Create indexes on primary keys (for performance)
CREATE INDEX IF NOT EXISTS idx_orders_id ON orders(id);
CREATE INDEX IF NOT EXISTS idx_tech_1_id ON tech_1(id);
CREATE INDEX IF NOT EXISTS idx_tech_2_id ON tech_2(id);
CREATE INDEX IF NOT EXISTS idx_tech_3_id ON tech_3(id);
CREATE INDEX IF NOT EXISTS idx_tech_4_id ON tech_4(id);
CREATE INDEX IF NOT EXISTS idx_packer_1_id ON packer_1(id);
CREATE INDEX IF NOT EXISTS idx_packer_2_id ON packer_2(id);
CREATE INDEX IF NOT EXISTS idx_packer_3_id ON packer_3(id);
CREATE INDEX IF NOT EXISTS idx_receiving_id ON receiving(id);
CREATE INDEX IF NOT EXISTS idx_shipped_id ON shipped(id);
CREATE INDEX IF NOT EXISTS idx_sku_stock_id ON sku_stock(id);
CREATE INDEX IF NOT EXISTS idx_sku_id ON sku(id);
CREATE INDEX IF NOT EXISTS idx_repair_service_id ON repair_service(id);

-- Verify table creation
SELECT 
    table_name,
    (SELECT COUNT(*) 
     FROM information_schema.columns 
     WHERE table_name = t.table_name) as column_count
FROM information_schema.tables t
WHERE table_schema = 'public'
AND table_name IN (
    'orders', 'tech_1', 'tech_2', 'tech_3', 'tech_4',
    'packer_1', 'packer_2', 'packer_3', 'receiving',
    'shipped', 'sku_stock', 'sku', 'repair_service'
)
ORDER BY table_name;

