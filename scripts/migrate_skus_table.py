#!/usr/bin/env python3
"""
Migrate SKU table: Create skus table with index
Converted from migrate-skus-table.js
"""

import os
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
from dotenv import load_dotenv

load_dotenv('.env.local')

DATABASE_URL = os.getenv('DATABASE_URL')

if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is not set")

def migrate():
    conn = psycopg2.connect(DATABASE_URL, sslmode='require')
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    cur = conn.cursor()
    
    try:
        print('Starting SKU table migration...')
        
        # Create skus table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS skus (
                sku VARCHAR(100) PRIMARY KEY,
                serial_numbers TEXT,
                notes TEXT
            );
        """)
        print('✓ skus table created.')
        
        # Add index for faster lookup
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_skus_sku ON skus(sku);
        """)
        print('✓ Index created.')
        
        print('\n✅ SKU table migration completed successfully!')
        
    except Exception as err:
        print(f'❌ Migration failed: {err}')
        raise
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    migrate()
