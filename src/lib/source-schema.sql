-- Source of Truth Database Schema
-- This schema mirrors Google Sheets structure for USAV Orders Backend
-- Created: January 5, 2026

-- Drop tables if they exist (use with caution!)
-- DROP TABLE IF EXISTS orders CASCADE;
-- DROP TABLE IF EXISTS tech_1, tech_2, tech_3, tech_4 CASCADE;
-- DROP TABLE IF EXISTS packer_1, packer_2, packer_3 CASCADE;
-- DROP TABLE IF EXISTS receiving, shipped, sku_stock, sku, rs CASCADE;

-- 1. ORDERS TABLE (10 columns)
CREATE TABLE IF NOT EXISTS orders (
    col_1 SERIAL PRIMARY KEY,
    col_2 TEXT,
    col_3 TEXT,
    col_4 TEXT,
    col_5 TEXT,
    col_6 TEXT,
    col_7 TEXT,
    col_8 TEXT,
    col_9 TEXT,
    col_10 TEXT
);

-- 2. TECH_1 TABLE (7 columns)
CREATE TABLE IF NOT EXISTS tech_1 (
    col_1 SERIAL PRIMARY KEY,
    col_2 TEXT,
    col_3 TEXT,
    col_4 TEXT,
    col_5 TEXT,
    col_6 TEXT,
    col_7 TEXT
);

-- 3. TECH_2 TABLE (7 columns)
CREATE TABLE IF NOT EXISTS tech_2 (
    col_1 SERIAL PRIMARY KEY,
    col_2 TEXT,
    col_3 TEXT,
    col_4 TEXT,
    col_5 TEXT,
    col_6 TEXT,
    col_7 TEXT
);

-- 4. TECH_3 TABLE (7 columns)
CREATE TABLE IF NOT EXISTS tech_3 (
    col_1 SERIAL PRIMARY KEY,
    col_2 TEXT,
    col_3 TEXT,
    col_4 TEXT,
    col_5 TEXT,
    col_6 TEXT,
    col_7 TEXT
);

-- 5. TECH_4 TABLE (7 columns)
CREATE TABLE IF NOT EXISTS tech_4 (
    col_1 SERIAL PRIMARY KEY,
    col_2 TEXT,
    col_3 TEXT,
    col_4 TEXT,
    col_5 TEXT,
    col_6 TEXT,
    col_7 TEXT
);

-- 6. PACKER_1 TABLE (5 columns)
CREATE TABLE IF NOT EXISTS packer_1 (
    col_1 SERIAL PRIMARY KEY,
    col_2 TEXT,
    col_3 TEXT,
    col_4 TEXT,
    col_5 TEXT
);

-- 7. PACKER_2 TABLE (5 columns)
CREATE TABLE IF NOT EXISTS packer_2 (
    col_1 SERIAL PRIMARY KEY,
    col_2 TEXT,
    col_3 TEXT,
    col_4 TEXT,
    col_5 TEXT
);

-- 8. PACKER_3 TABLE (5 columns)
CREATE TABLE IF NOT EXISTS packer_3 (
    col_1 SERIAL PRIMARY KEY,
    col_2 TEXT,
    col_3 TEXT,
    col_4 TEXT,
    col_5 TEXT
);

-- 9. RECEIVING TABLE (5 columns)
CREATE TABLE IF NOT EXISTS receiving (
    col_1 SERIAL PRIMARY KEY,
    col_2 TEXT,
    col_3 TEXT,
    col_4 TEXT,
    col_5 TEXT
);

-- 10. SHIPPED TABLE (10 columns)
CREATE TABLE IF NOT EXISTS shipped (
    col_1 SERIAL PRIMARY KEY,
    col_2 TEXT,
    col_3 TEXT,
    col_4 TEXT,
    col_5 TEXT,
    col_6 TEXT,
    col_7 TEXT,
    col_8 TEXT,
    col_9 TEXT,
    col_10 TEXT
);

-- 11. SKU_STOCK TABLE (5 columns)
CREATE TABLE IF NOT EXISTS sku_stock (
    col_1 SERIAL PRIMARY KEY,
    col_2 TEXT,
    col_3 TEXT,
    col_4 TEXT,
    col_5 TEXT
);

-- 12. SKU TABLE (8 columns)
CREATE TABLE IF NOT EXISTS sku (
    col_1 SERIAL PRIMARY KEY,
    col_2 TEXT,
    col_3 TEXT,
    col_4 TEXT,
    col_5 TEXT,
    col_6 TEXT,
    col_7 TEXT,
    col_8 TEXT
);

-- 13. RS TABLE (10 columns)
CREATE TABLE IF NOT EXISTS rs (
    col_1 SERIAL PRIMARY KEY,
    col_2 TEXT,
    col_3 TEXT,
    col_4 TEXT,
    col_5 TEXT,
    col_6 TEXT,
    col_7 TEXT,
    col_8 TEXT,
    col_9 TEXT,
    col_10 TEXT
);

-- Create indexes on primary keys (for performance)
CREATE INDEX IF NOT EXISTS idx_orders_col_1 ON orders(col_1);
CREATE INDEX IF NOT EXISTS idx_tech_1_col_1 ON tech_1(col_1);
CREATE INDEX IF NOT EXISTS idx_tech_2_col_1 ON tech_2(col_1);
CREATE INDEX IF NOT EXISTS idx_tech_3_col_1 ON tech_3(col_1);
CREATE INDEX IF NOT EXISTS idx_tech_4_col_1 ON tech_4(col_1);
CREATE INDEX IF NOT EXISTS idx_packer_1_col_1 ON packer_1(col_1);
CREATE INDEX IF NOT EXISTS idx_packer_2_col_1 ON packer_2(col_1);
CREATE INDEX IF NOT EXISTS idx_packer_3_col_1 ON packer_3(col_1);
CREATE INDEX IF NOT EXISTS idx_receiving_col_1 ON receiving(col_1);
CREATE INDEX IF NOT EXISTS idx_shipped_col_1 ON shipped(col_1);
CREATE INDEX IF NOT EXISTS idx_sku_stock_col_1 ON sku_stock(col_1);
CREATE INDEX IF NOT EXISTS idx_sku_col_1 ON sku(col_1);
CREATE INDEX IF NOT EXISTS idx_rs_col_1 ON rs(col_1);

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
    'shipped', 'sku_stock', 'sku', 'rs'
)
ORDER BY table_name;

