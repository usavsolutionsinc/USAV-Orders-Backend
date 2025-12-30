#!/usr/bin/env python3
"""
Setup all required database tables for Google Sheets sync.
Creates tables with position-based columns (col_1, col_2, etc.) to match sheet columns A, B, C, etc.
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
    """Create all required database tables with position-based column structure"""
    conn = psycopg2.connect(DATABASE_URL, sslmode='require')
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    cur = conn.cursor()
    
    try:
        print("Creating all required tables with position-based columns...")
        
        # Orders table - Columns A-P (16 columns) - mapped as col_1 to col_16
        cur.execute("""
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                col_1 TEXT,  -- A: SIZE
                col_2 TEXT,  -- B: Platform
                col_3 TEXT,  -- C: Order ID (also used as id)
                col_4 TEXT,  -- D: Buyer Name
                col_5 TEXT,  -- E: Product Title
                col_6 TEXT,  -- F: #
                col_7 TEXT,  -- G: Ship
                col_8 TEXT,  -- H: SKU
                col_9 TEXT,  -- I: Item #
                col_10 TEXT, -- J: As
                col_11 TEXT, -- K: Shipping TRK #
                col_12 TEXT, -- L: (empty)
                col_13 TEXT, -- M: OOS - We Need
                col_14 TEXT, -- N: Receiving TRK #
                col_15 TEXT, -- O: Stock Status / Location
                col_16 TEXT, -- P: Notes
                order_id VARCHAR(50),  -- Duplicate of col_3 for easy lookup
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        print("✓ orders table created/verified (16 columns A-P as col_1-col_16)")
        
        # Tech tables (tech_1, tech_2, tech_3) - Columns A-H (8 columns)
        for tech_num in range(1, 4):  # 1, 2, 3
            table_name = f"tech_{tech_num}"
            cur.execute(f"""
                CREATE TABLE IF NOT EXISTS {table_name} (
                    id SERIAL PRIMARY KEY,
                    col_1 TEXT,  -- A: Date / Time
                    col_2 TEXT,  -- B: Title - Testing
                    col_3 TEXT,  -- C: Shipping TRK # / Testing
                    col_4 TEXT,  -- D: Serial Number Data
                    col_5 TEXT,  -- E: Input
                    col_6 TEXT,  -- F: As
                    col_7 TEXT,  -- G: SKU
                    col_8 TEXT,  -- H: #
                    tech_id VARCHAR(50) DEFAULT '{tech_num}',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            print(f"✓ {table_name} table created (8 columns A-H as col_1-col_8)")
        
        # Packer tables (Packer_1, Packer_2, Packer_3) - Columns A-D (4 columns)
        for packer_num in range(1, 4):  # 1, 2, 3
            table_name = f"Packer_{packer_num}"
            cur.execute(f"""
                CREATE TABLE IF NOT EXISTS {table_name} (
                    id SERIAL PRIMARY KEY,
                    col_1 TEXT,  -- A: Date / Time
                    col_2 TEXT,  -- B: Tracking Number/FNSKU
                    col_3 TEXT,  -- C: ID
                    col_4 TEXT,  -- D: Product Title
                    col_5 TEXT,  -- E: # (if exists)
                    packer_id VARCHAR(50) DEFAULT '{packer_num}',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            print(f"✓ {table_name} table created (4-5 columns A-D/E as col_1-col_5)")
        
        # Receiving table - Columns A-D (4 columns)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS receiving (
                id SERIAL PRIMARY KEY,
                col_1 TEXT,  -- A: Date / Time
                col_2 TEXT,  -- B: Tracking Number
                col_3 TEXT,  -- C: Carrier
                col_4 TEXT,  -- D: Qty
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        print("✓ receiving table created/verified (4 columns A-D as col_1-col_4)")
        
        # Shipped table - Columns A-J (10 columns)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS shipped (
                id SERIAL PRIMARY KEY,
                col_1 TEXT,  -- A: Date / Time
                col_2 TEXT,  -- B: Order ID
                col_3 TEXT,  -- C: Product Title
                col_4 TEXT,  -- D: Sent
                col_5 TEXT,  -- E: Shipping TRK #
                col_6 TEXT,  -- F: Serial Number
                col_7 TEXT,  -- G: Box
                col_8 TEXT,  -- H: By
                col_9 TEXT,  -- I: SKU
                col_10 TEXT, -- J: Status
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        print("✓ shipped table created/verified (10 columns A-J as col_1-col_10)")
        
        # SKU Stock table - Columns A-E (5 columns)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sku_stock (
                id SERIAL PRIMARY KEY,
                col_1 TEXT,  -- A: SKU (also used as unique key)
                col_2 TEXT,  -- B: Size
                col_3 TEXT,  -- C: Title
                col_4 TEXT,  -- D: Condition
                col_5 TEXT,  -- E: Quantity
                sku VARCHAR(100),  -- Duplicate of col_1 for easy lookup
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(sku)
            );
        """)
        print("✓ sku_stock table created/verified (5 columns A-E as col_1-col_5)")
        
        # SKU table - Columns A-H (8 columns)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS skus (
                id SERIAL PRIMARY KEY,
                col_1 TEXT,  -- A: Store Date / Time
                col_2 TEXT,  -- B: Static SKU
                col_3 TEXT,  -- C: Serial Numbers
                col_4 TEXT,  -- D: Shipping TRK #
                col_5 TEXT,  -- E: Product Title
                col_6 TEXT,  -- F: Size
                col_7 TEXT,  -- G: Notes
                col_8 TEXT,  -- H: Location
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        print("✓ skus table created/verified (8 columns A-H as col_1-col_8)")
        
        # Create indexes for better performance
        indexes = [
            ("idx_orders_col3", "orders", "col_3"),
            ("idx_orders_order_id", "orders", "order_id"),
            ("idx_tech1_col3", "tech_1", "col_3"),
            ("idx_packer1_col2", "Packer_1", "col_2"),
            ("idx_receiving_col2", "receiving", "col_2"),
            ("idx_shipped_col2", "shipped", "col_2"),
            ("idx_shipped_col5", "shipped", "col_5"),
            ("idx_sku_stock_col1", "sku_stock", "col_1"),
            ("idx_sku_stock_sku", "sku_stock", "sku"),
            ("idx_skus_col2", "skus", "col_2"),
        ]
        
        for idx_name, table, column in indexes:
            try:
                cur.execute(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table}({column});")
            except Exception as e:
                print(f"  Note: Index {idx_name} may already exist: {e}")
        
        print("\n✅ All tables created successfully with position-based columns!")
        
    except Exception as e:
        print(f"❌ Error creating tables: {e}")
        raise
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    create_tables()
