#!/usr/bin/env python3
"""
Setup initial database tables: orders, shipped, receiving
Converted from setup-db.js
"""

import os
import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
from dotenv import load_dotenv

load_dotenv('.env.local')

DATABASE_URL = os.getenv('DATABASE_URL')

if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is not set")

def setup():
    conn = psycopg2.connect(DATABASE_URL, sslmode='require')
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    cur = conn.cursor()
    
    try:
        print('Creating tables...')
        
        # Orders Table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS orders (
                id VARCHAR(50) PRIMARY KEY,
                buyer_name VARCHAR(255),
                product_title TEXT,
                qty INTEGER,
                ship_by DATE,
                sku VARCHAR(100),
                shipping_speed VARCHAR(50),
                tracking_number VARCHAR(100),
                status VARCHAR(50) DEFAULT 'Pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        print('✓ Orders table created/verified.')
        
        # Shipped Table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS shipped (
                id VARCHAR(50) PRIMARY KEY,
                order_id VARCHAR(50),
                shipped_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                carrier VARCHAR(50),
                tracking_number VARCHAR(100),
                FOREIGN KEY (order_id) REFERENCES orders(id)
            );
        """)
        print('✓ Shipped table created/verified.')
        
        # Receiving Table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS receiving (
                id SERIAL PRIMARY KEY,
                item_name VARCHAR(255),
                expected_qty INTEGER,
                received_qty INTEGER DEFAULT 0,
                supplier VARCHAR(255),
                status VARCHAR(50) DEFAULT 'Pending',
                arrival_date DATE
            );
        """)
        print('✓ Receiving table created/verified.')
        
        # Seed Data (Optional - only if empty)
        cur.execute('SELECT COUNT(*) FROM orders')
        order_count = cur.fetchone()[0]
        
        if order_count == 0:
            print('Seeding orders...')
            cur.execute("""
                INSERT INTO orders (id, buyer_name, product_title, qty, ship_by, sku, shipping_speed, tracking_number)
                VALUES 
                ('ORD-1001', 'John Doe', 'Wireless Headphones', 1, '2023-12-01', 'WH-001', 'Standard', 'TRK123456'),
                ('ORD-1002', 'Jane Smith', 'Gaming Mouse', 2, '2023-12-02', 'GM-002', 'Express', 'TRK789012');
            """)
            print('✓ Sample orders seeded.')
        
        print('\n✅ Database setup completed successfully!')
        
    except Exception as err:
        print(f'❌ Error setting up DB: {err}')
        raise
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    setup()
