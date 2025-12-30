#!/usr/bin/env python3
"""
Setup all required database tables for Google Sheets sync.
Creates tables matching exact column structure from Google Sheets.
Tables: orders, tech_1-3, receiving, Packer_1-3, shipped, sku_stock, sku
Note: Table numbering starts from 1 (not 0) to match website naming.
"""

import os
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
from dotenv import load_dotenv

# Load environment variables
load_dotenv('.env.local')

DATABASE_URL = os.getenv('DATABASE_URL')

if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is not set")

def create_tables():
    """Create all required database tables with exact column structure"""
    conn = psycopg2.connect(DATABASE_URL, sslmode='require')
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    cur = conn.cursor()
    
    try:
        print("Creating all required tables with exact column structure...")
        
        # Orders table - Columns A-P (16 columns)
        # A: SIZE, B: Platform, C: Order ID, D: Buyer Name, E: Product Title, F: #, G: Ship, H: SKU
        # I: Item #, J: As, K: Shipping TRK #, L: (empty), M: OOS - We Need, N: Receiving TRK #, O: Stock Status / Location, P: Notes
        cur.execute("""
            CREATE TABLE IF NOT EXISTS orders (
                id VARCHAR(50) PRIMARY KEY,
                size VARCHAR(50),
                platform VARCHAR(100),
                order_id VARCHAR(50) UNIQUE,
                buyer_name VARCHAR(255),
                product_title TEXT,
                quantity INTEGER,
                ship VARCHAR(50),
                sku VARCHAR(100),
                item_index VARCHAR(50),
                asin VARCHAR(50),
                shipping_trk_number VARCHAR(100),
                oos_needed TEXT,
                receiving_trk_number VARCHAR(100),
                stock_status_location VARCHAR(255),
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        print("✓ orders table created/verified (16 columns A-P)")
        
        # Tech tables (tech_1, tech_2, tech_3) - Columns A-H (8 columns)
        # A: Date / Time, B: Title - Testing, C: Shipping TRK # / Testing, D: Serial Number Data
        # E: Input, F: As, G: SKU, H: #
        for tech_num in range(1, 4):  # 1, 2, 3
            table_name = f"tech_{tech_num}"
            cur.execute(f"""
                CREATE TABLE IF NOT EXISTS {table_name} (
                    id SERIAL PRIMARY KEY,
                    date_time TIMESTAMP,
                    title_testing TEXT,
                    shipping_trk_testing VARCHAR(100),
                    serial_number_data TEXT,
                    input VARCHAR(255),
                    asin VARCHAR(50),
                    sku VARCHAR(100),
                    quantity INTEGER,
                    tech_id VARCHAR(50) DEFAULT '{tech_num}',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            print(f"✓ {table_name} table created (8 columns A-H)")
        
        # Packer tables (Packer_1, Packer_2, Packer_3) - Columns A-D (4 columns)
        # A: Date / Time, B: Tracking Number/FNSKU, C: ID, D: Product Title, E: # (if exists)
        for packer_num in range(1, 4):  # 1, 2, 3
            table_name = f"Packer_{packer_num}"
            cur.execute(f"""
                CREATE TABLE IF NOT EXISTS {table_name} (
                    id SERIAL PRIMARY KEY,
                    date_time TIMESTAMP,
                    tracking_number_fnsku VARCHAR(100),
                    order_id VARCHAR(50),
                    product_title TEXT,
                    quantity INTEGER,
                    packer_id VARCHAR(50) DEFAULT '{packer_num}',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            print(f"✓ {table_name} table created (4-5 columns A-D/E)")
        
        # Receiving table - Columns A-D (4 columns)
        # A: Date / Time, B: Tracking Number, C: Carrier, D: Qty
        cur.execute("""
            CREATE TABLE IF NOT EXISTS receiving (
                id SERIAL PRIMARY KEY,
                date_time TIMESTAMP,
                tracking_number VARCHAR(100),
                carrier VARCHAR(50),
                qty INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        print("✓ receiving table created/verified (4 columns A-D)")
        
        # Shipped table - Columns A-J (10 columns)
        # A: Date / Time, B: Order ID, C: Product Title, D: Sent, E: Shipping TRK #, F: Serial Number, G: Box, H: By, I: SKU, J: Status
        cur.execute("""
            CREATE TABLE IF NOT EXISTS shipped (
                id SERIAL PRIMARY KEY,
                date_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                order_id VARCHAR(50),
                product_title TEXT,
                sent VARCHAR(50),
                shipping_trk_number VARCHAR(100),
                serial_number TEXT,
                box VARCHAR(50),
                by_name VARCHAR(100),
                sku VARCHAR(100),
                status VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        print("✓ shipped table created/verified (10 columns A-J)")
        
        # SKU Stock table - Columns A-E (5 columns)
        # A: SKU, B: Size, C: Title, D: Condition, E: (possibly quantity or other)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sku_stock (
                sku VARCHAR(100) PRIMARY KEY,
                size VARCHAR(50),
                title TEXT,
                condition VARCHAR(50),
                quantity INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        print("✓ sku_stock table created/verified (5 columns A-E)")
        
        # SKU table - Columns A-H (8 columns)
        # A: Store Date / Time, B: Static SKU, C: Serial Numbers, D: Shipping TRK #, E: Product Title, F: Size, G: Notes, H: Location
        cur.execute("""
            CREATE TABLE IF NOT EXISTS skus (
                id SERIAL PRIMARY KEY,
                store_date_time TIMESTAMP,
                static_sku VARCHAR(100),
                serial_numbers TEXT,
                shipping_trk_number VARCHAR(100),
                product_title TEXT,
                size VARCHAR(50),
                notes TEXT,
                location VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        print("✓ skus table created/verified (8 columns A-H)")
        
        # Create indexes for better performance
        indexes = [
            ("idx_orders_order_id", "orders", "order_id"),
            ("idx_orders_tracking", "orders", "shipping_trk_number"),
            ("idx_tech1_tracking", "tech_1", "shipping_trk_testing"),
            ("idx_packer1_tracking", "Packer_1", "tracking_number_fnsku"),
            ("idx_receiving_tracking", "receiving", "tracking_number"),
            ("idx_shipped_order_id", "shipped", "order_id"),
            ("idx_shipped_tracking", "shipped", "shipping_trk_number"),
            ("idx_sku_stock_sku", "sku_stock", "sku"),
            ("idx_skus_static_sku", "skus", "static_sku"),
        ]
        
        for idx_name, table, column in indexes:
            try:
                cur.execute(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table}({column});")
            except Exception as e:
                print(f"  Note: Index {idx_name} may already exist: {e}")
        
        print("\n✅ All tables created successfully with exact column structure!")
        
    except Exception as e:
        print(f"❌ Error creating tables: {e}")
        raise
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    create_tables()
