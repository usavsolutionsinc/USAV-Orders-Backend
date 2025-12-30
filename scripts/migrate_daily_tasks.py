#!/usr/bin/env python3
"""
Migrate daily tasks tables: task_templates and daily_task_instances
Converted from migrate-daily-tasks.js
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
        print('Starting daily tasks migration...')
        
        # 1. Task Templates Table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS task_templates (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                role VARCHAR(50) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        print('✓ task_templates table created.')
        
        # 2. Daily Task Instances Table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS daily_task_instances (
                id SERIAL PRIMARY KEY,
                template_id INTEGER REFERENCES task_templates(id) ON DELETE CASCADE,
                user_id VARCHAR(50) NOT NULL,
                role VARCHAR(50) NOT NULL,
                task_date DATE NOT NULL,
                completed BOOLEAN DEFAULT FALSE,
                completed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, template_id, task_date)
            );
        """)
        print('✓ daily_task_instances table created.')
        
        # 3. Create index for faster lookups
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_daily_tasks_user_date 
            ON daily_task_instances(user_id, task_date);
        """)
        print('✓ Index created.')
        
        # 4. Seed some default task templates (optional - can be managed via admin later)
        cur.execute('SELECT COUNT(*) FROM task_templates')
        template_count = cur.fetchone()[0]
        
        if template_count == 0:
            print('Seeding default task templates...')
            
            # Default packer tasks
            cur.execute("""
                INSERT INTO task_templates (title, description, role) VALUES
                ('Check packing supplies', 'Verify tape, boxes, and labels are stocked', 'packer'),
                ('Review daily orders', 'Check assigned orders for the day', 'packer'),
                ('Verify order accuracy', 'Double-check items match order details', 'packer'),
                ('Print shipping labels', 'Generate and attach shipping labels', 'packer'),
                ('Update order status', 'Mark orders as packed in system', 'packer');
            """)
            
            # Default technician tasks
            cur.execute("""
                INSERT INTO task_templates (title, description, role) VALUES
                ('Check equipment', 'Verify testing equipment is functional', 'technician'),
                ('Review assigned orders', 'Check orders requiring technician work', 'technician'),
                ('Test products', 'Perform quality checks on products', 'technician'),
                ('Record serial numbers', 'Log serial numbers for tracked items', 'technician'),
                ('Update order status', 'Mark orders as completed in system', 'technician');
            """)
            
            print('✓ Default task templates seeded.')
        
        print('\n✅ Daily tasks migration completed successfully!')
        
    except Exception as err:
        print(f'❌ Migration failed: {err}')
        raise
    finally:
        cur.close()
        conn.close()

if __name__ == "__main__":
    migrate()
