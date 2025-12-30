#!/usr/bin/env python3
"""
Migrate GAS (Google Apps Script) logic tables:
- sku_stock
- technician_logs
- packer_logs
- receiving_logs
- Alter shipped table with additional columns
Converted from migrate-gas-logic.js
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
        print('Starting migration...')
        
        # 1. SKU Stock Table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sku_stock (
                sku VARCHAR(100) PRIMARY KEY,
                quantity INTEGER DEFAULT 0,
                title TEXT,
                serial_numbers TEXT
            );
        """)
        print('✓ sku_stock table created.')
        
        # 2. Technician Logs
        cur.execute("""
            CREATE TABLE IF NOT EXISTS technician_logs (
                id SERIAL PRIMARY KEY,
                tech_id VARCHAR(50),
                tracking_number VARCHAR(100),
                action VARCHAR(50),
                details TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        print('✓ technician_logs table created.')
        
        # 3. Packer Logs
        cur.execute("""
            CREATE TABLE IF NOT EXISTS packer_logs (
                id SERIAL PRIMARY KEY,
                packer_id VARCHAR(50),
                tracking_number VARCHAR(100),
                action VARCHAR(50),
                details TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        print('✓ packer_logs table created.')
        
        # 4. Receiving Logs
        cur.execute("""
            CREATE TABLE IF NOT EXISTS receiving_logs (
                id SERIAL PRIMARY KEY,
                tracking_number VARCHAR(100),
                carrier VARCHAR(50),
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        print('✓ receiving_logs table created.')
        
        # 5. Alter Shipped Table (Add columns from GAS logic)
        # Check if columns exist first to avoid errors
        cur.execute("""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                              WHERE table_name='shipped' AND column_name='serial_numbers') THEN
                    ALTER TABLE shipped ADD COLUMN serial_numbers TEXT;
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                              WHERE table_name='shipped' AND column_name='tech_name') THEN
                    ALTER TABLE shipped ADD COLUMN tech_name VARCHAR(100);
                END IF;
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                              WHERE table_name='shipped' AND column_name='status') THEN
                    ALTER TABLE shipped ADD COLUMN status VARCHAR(50);
                END IF;
            END
            $$;
        """)
        print('✓ shipped table altered.')
        
        print('\n✅ GAS logic migration completed successfully!')
        
    except Exception as err:
        print(f'❌ Migration failed: {err}')
        raise
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    migrate()
