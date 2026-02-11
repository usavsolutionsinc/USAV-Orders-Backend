import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        console.log('🚀 Starting Drizzle schema setup...');
        console.log('📊 DATABASE_URL:', process.env.DATABASE_URL ? 'SET ✓' : 'NOT SET ✗');

        const tables = [];

        // 1. Staff table
        console.log('Creating staff table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS staff (
                id SERIAL PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                role VARCHAR(50) NOT NULL,
                employee_id VARCHAR(50) UNIQUE,
                active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        tables.push('staff');

        // 2. Task templates table
        console.log('Creating task_templates table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS task_templates (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                description TEXT,
                role VARCHAR(50) NOT NULL,
                order_number VARCHAR(100),
                tracking_number VARCHAR(100),
                created_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Add missing columns if table already exists
        await client.query(`
            DO $$ 
            BEGIN
                BEGIN
                    ALTER TABLE task_templates ADD COLUMN order_number VARCHAR(100);
                EXCEPTION
                    WHEN duplicate_column THEN NULL;
                END;
                BEGIN
                    ALTER TABLE task_templates ADD COLUMN tracking_number VARCHAR(100);
                EXCEPTION
                    WHEN duplicate_column THEN NULL;
                END;
                BEGIN
                    ALTER TABLE task_templates ADD COLUMN created_by INTEGER REFERENCES staff(id) ON DELETE SET NULL;
                EXCEPTION
                    WHEN duplicate_column THEN NULL;
                END;
            END $$;
        `);
        tables.push('task_templates');

        // 3. Daily task instances
        console.log('Creating daily_task_instances table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS daily_task_instances (
                id SERIAL PRIMARY KEY,
                template_id INTEGER REFERENCES task_templates(id) ON DELETE CASCADE,
                staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE,
                task_date DATE NOT NULL,
                status VARCHAR(20) DEFAULT 'pending',
                started_at TIMESTAMP,
                completed_at TIMESTAMP,
                duration_minutes INTEGER,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(template_id, staff_id, task_date)
            )
        `);
        
        // Add missing columns if table already exists
        await client.query(`
            DO $$ 
            BEGIN
                BEGIN
                    ALTER TABLE daily_task_instances ADD COLUMN staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE;
                EXCEPTION
                    WHEN duplicate_column THEN NULL;
                END;
                BEGIN
                    ALTER TABLE daily_task_instances ADD COLUMN status VARCHAR(20) DEFAULT 'pending';
                EXCEPTION
                    WHEN duplicate_column THEN NULL;
                END;
                BEGIN
                    ALTER TABLE daily_task_instances ADD COLUMN started_at TIMESTAMP;
                EXCEPTION
                    WHEN duplicate_column THEN NULL;
                END;
                BEGIN
                    ALTER TABLE daily_task_instances ADD COLUMN duration_minutes INTEGER;
                EXCEPTION
                    WHEN duplicate_column THEN NULL;
                END;
                BEGIN
                    ALTER TABLE daily_task_instances ADD COLUMN notes TEXT;
                EXCEPTION
                    WHEN duplicate_column THEN NULL;
                END;
            END $$;
        `);
        tables.push('daily_task_instances');

        // 6. Receiving tasks table
        console.log('Creating receiving_tasks table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS receiving_tasks (
                id SERIAL PRIMARY KEY,
                tracking_number VARCHAR(100) NOT NULL,
                order_number VARCHAR(100),
                status VARCHAR(20) DEFAULT 'pending',
                received_date TIMESTAMP,
                processed_date TIMESTAMP,
                notes TEXT,
                staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        tables.push('receiving_tasks');

        // 7-19. Source of truth tables
        console.log('Creating source of truth tables...');
        
        // Orders
        await client.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                ship_by_date TEXT,
                order_id TEXT,
                item_number TEXT,
                product_title TEXT,
                quantity TEXT,
                sku TEXT,
                condition TEXT,
                shipping_tracking_number TEXT,
                out_of_stock TEXT,
                notes TEXT,
                status TEXT NOT NULL DEFAULT 'unassigned'
            )
        `);
        tables.push('orders');

        // Packer logs - audit trail for all packer scans
        await client.query(`
            CREATE TABLE IF NOT EXISTS packer_logs (
                id SERIAL PRIMARY KEY,
                shipping_tracking_number TEXT NOT NULL,
                tracking_type VARCHAR(20) NOT NULL,
                pack_date_time TIMESTAMP,
                packed_by INTEGER REFERENCES staff(id) ON DELETE SET NULL,
                packer_photos_url JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        tables.push('packer_logs');

        // Tech tables (7 columns each)
        for (let i = 1; i <= 4; i++) {
            await client.query(`
                CREATE TABLE IF NOT EXISTS tech_${i} (
                    id SERIAL PRIMARY KEY,
                    date_time TEXT,
                    product_title TEXT,
                    shipping_tracking_number TEXT,
                    serial_number TEXT,
                    condition TEXT,
                    quantity TEXT
                )
            `);
            tables.push(`tech_${i}`);
        }

        // Packer tables (6 columns each)
        for (let i = 1; i <= 3; i++) {
            await client.query(`
                CREATE TABLE IF NOT EXISTS packer_${i} (
                    id SERIAL PRIMARY KEY,
                    date_time TEXT,
                    shipping_tracking_number TEXT,
                    carrier TEXT,
                    product_title TEXT,
                    quantity TEXT
                )
            `);
            tables.push(`packer_${i}`);
        }

        // Receiving
        await client.query(`
            CREATE TABLE IF NOT EXISTS receiving (
                id SERIAL PRIMARY KEY,
                date_time TEXT,
                receiving_tracking_number TEXT,
                carrier TEXT,
                quantity TEXT
            )
        `);
        tables.push('receiving');

        // Shipped (13 columns)
        await client.query(`
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
            )
        `);
        tables.push('shipped');

        // SKU Stock (5 columns)
        await client.query(`
            CREATE TABLE IF NOT EXISTS sku_stock (
                id SERIAL PRIMARY KEY,
                stock TEXT,
                sku TEXT,
                size TEXT,
                product_title TEXT
            )
        `);
        tables.push('sku_stock');

        // SKU
        await client.query(`
            CREATE TABLE IF NOT EXISTS sku (
                id SERIAL PRIMARY KEY,
                date_time TEXT,
                static_sku TEXT,
                serial_number TEXT,
                shipping_tracking_number TEXT,
                product_title TEXT,
                notes TEXT,
                location TEXT
            )
        `);
        tables.push('sku');

        // Repair Service (formerly rs)
        await client.query(`
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
            )
        `);
        tables.push('repair_service');

        // 20. Packing logs table
        console.log('Creating packing_logs table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS packing_logs (
                id SERIAL PRIMARY KEY,
                tracking_number VARCHAR(100) NOT NULL,
                order_id VARCHAR(100),
                photos TEXT,
                packer_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
                box_size VARCHAR(50),
                packed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                notes TEXT,
                status VARCHAR(20) DEFAULT 'completed'
            )
        `);
        
        // Add order_id if it doesn't exist
        await client.query(`
            DO $$ 
            BEGIN
                BEGIN
                    ALTER TABLE packing_logs ADD COLUMN order_id VARCHAR(100);
                EXCEPTION
                    WHEN duplicate_column THEN NULL;
                END;
            END $$;
        `);
        tables.push('packing_logs');

        // Create indexes
        console.log('Creating indexes...');
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_staff_role ON staff(role)',
            'CREATE INDEX IF NOT EXISTS idx_staff_active ON staff(active)',
            'CREATE INDEX IF NOT EXISTS idx_task_templates_role ON task_templates(role)',
            'CREATE INDEX IF NOT EXISTS idx_daily_instances_date ON daily_task_instances(task_date)',
            'CREATE INDEX IF NOT EXISTS idx_daily_instances_staff ON daily_task_instances(staff_id)',
            'CREATE INDEX IF NOT EXISTS idx_daily_instances_status ON daily_task_instances(status)',
            'CREATE INDEX IF NOT EXISTS idx_receiving_tasks_tracking ON receiving_tasks(tracking_number)',
            'CREATE INDEX IF NOT EXISTS idx_receiving_tasks_status ON receiving_tasks(status)',
            'CREATE INDEX IF NOT EXISTS idx_packing_logs_tracking ON packing_logs(tracking_number)',
            'CREATE INDEX IF NOT EXISTS idx_packing_logs_order_id ON packing_logs(order_id)',
        ];

        for (const indexQuery of indexes) {
            await client.query(indexQuery);
        }

        // Insert default data
        console.log('Inserting default data...');

        // Sample staff
        const defaultStaff = [
            { name: 'Tech Station 1', role: 'technician', employee_id: 'TECH001' },
            { name: 'Tech Station 2', role: 'technician', employee_id: 'TECH002' },
            { name: 'Tech Station 3', role: 'technician', employee_id: 'TECH003' },
            { name: 'Packer Station 1', role: 'packer', employee_id: 'PACK001' },
            { name: 'Packer Station 2', role: 'packer', employee_id: 'PACK002' },
        ];

        for (const staff of defaultStaff) {
            await client.query(
                'INSERT INTO staff (name, role, employee_id) VALUES ($1, $2, $3) ON CONFLICT (employee_id) DO NOTHING',
                [staff.name, staff.role, staff.employee_id]
            );
        }

        await client.query('COMMIT');

        return NextResponse.json({ 
            success: true, 
            message: '✅ Drizzle schema setup completed successfully!',
            environment: 'Vercel',
            database_url_configured: !!process.env.DATABASE_URL,
            tables_created: tables.length,
            tables: tables,
            indexes_created: indexes.length,
            default_staff_inserted: 5,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Database setup error:', error);
        return NextResponse.json({ 
            success: false, 
            error: 'Database setup failed', 
            details: error instanceof Error ? error.message : 'Unknown error',
            database_url_configured: !!process.env.DATABASE_URL,
        }, { status: 500 });
    } finally {
        client.release();
    }
}

// GET endpoint to verify schema
export async function GET() {
    try {
        const result = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        `);

        const expectedTables = [
            'staff', 'task_templates', 'daily_task_instances', 
            'receiving_tasks', 'orders', 'tech_1', 'tech_2', 'tech_3', 'tech_4',
            'packer_1', 'packer_2', 'packer_3', 'receiving', 'shipped', 'sku_stock', 
            'sku', 'repair_service', 'packing_logs'
        ];

        const existingTables = result.rows.map(r => r.table_name);
        const missingTables = expectedTables.filter(t => !existingTables.includes(t));

        return NextResponse.json({
            success: true,
            database_url_configured: !!process.env.DATABASE_URL,
            total_tables: existingTables.length,
            existing_tables: existingTables,
            expected_tables: expectedTables.length,
            missing_tables: missingTables,
            schema_complete: missingTables.length === 0,
        });
    } catch (error) {
        console.error('Error checking schema:', error);
        return NextResponse.json({ 
            success: false, 
            error: 'Failed to check schema',
            details: error instanceof Error ? error.message : 'Unknown error',
            database_url_configured: !!process.env.DATABASE_URL,
        }, { status: 500 });
    }
}
