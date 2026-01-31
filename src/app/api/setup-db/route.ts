import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import fs from 'fs';
import path from 'path';

export async function POST() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        console.log('Creating tables...');

        // Staff/Users Table
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

        // Check if task_templates needs migration
        const checkTemplateColumns = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'task_templates'
        `);

        const existingColumns = checkTemplateColumns.rows.map(r => r.column_name);
        
        if (!existingColumns.includes('order_number')) {
            console.log('Adding order_number column to task_templates...');
            await client.query(`
                ALTER TABLE task_templates 
                ADD COLUMN IF NOT EXISTS order_number VARCHAR(100)
            `);
        }

        if (!existingColumns.includes('tracking_number')) {
            console.log('Adding tracking_number column to task_templates...');
            await client.query(`
                ALTER TABLE task_templates 
                ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(100)
            `);
        }

        if (!existingColumns.includes('created_by')) {
            console.log('Adding created_by column to task_templates...');
            await client.query(`
                ALTER TABLE task_templates 
                ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES staff(id) ON DELETE SET NULL
            `);
        }

        // Check if daily_task_instances needs migration
        const checkInstanceColumns = await client.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'daily_task_instances'
        `);

        const instanceColumns = checkInstanceColumns.rows.map(r => r.column_name);

        // Rename user_id to staff_id if exists
        if (instanceColumns.includes('user_id') && !instanceColumns.includes('staff_id')) {
            console.log('Migrating user_id to staff_id...');
            
            // First, create staff entries for existing user_ids
            const existingUsers = await client.query(`
                SELECT DISTINCT user_id, role 
                FROM daily_task_instances 
                WHERE user_id IS NOT NULL
                ORDER BY role, user_id
            `);

            for (const user of existingUsers.rows) {
                const employeeId = `${user.role === 'technician' ? 'TECH' : 'PACK'}00${user.user_id}`;
                const name = `${user.role === 'technician' ? 'Tech' : 'Packer'} Station ${user.user_id}`;
                
                await client.query(`
                    INSERT INTO staff (name, role, employee_id)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (employee_id) DO NOTHING
                `, [name, user.role, employeeId]);
            }

            // Add staff_id column
            await client.query(`
                ALTER TABLE daily_task_instances 
                ADD COLUMN IF NOT EXISTS staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE
            `);

            // Migrate data from user_id to staff_id
            await client.query(`
                UPDATE daily_task_instances dti
                SET staff_id = s.id
                FROM staff s
                WHERE dti.role = s.role 
                AND s.employee_id = CONCAT(
                    CASE 
                        WHEN dti.role = 'technician' THEN 'TECH'
                        ELSE 'PACK'
                    END,
                    '00',
                    dti.user_id
                )
                AND dti.staff_id IS NULL
            `);

            // Make user_id nullable for backwards compatibility
            await client.query(`ALTER TABLE daily_task_instances ALTER COLUMN user_id DROP NOT NULL`);
        }

        // Add new columns to daily_task_instances
        if (!instanceColumns.includes('status')) {
            console.log('Adding status column...');
            await client.query(`
                ALTER TABLE daily_task_instances 
                ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending'
            `);

            // Migrate completed flag to status
            if (instanceColumns.includes('completed')) {
                await client.query(`
                    UPDATE daily_task_instances 
                    SET status = CASE 
                        WHEN completed = true THEN 'completed'
                        ELSE 'pending'
                    END
                    WHERE status = 'pending'
                `);
            }
        }

        if (!instanceColumns.includes('started_at')) {
            console.log('Adding started_at column...');
            await client.query(`
                ALTER TABLE daily_task_instances 
                ADD COLUMN IF NOT EXISTS started_at TIMESTAMP
            `);
        }

        if (!instanceColumns.includes('duration_minutes')) {
            console.log('Adding duration_minutes column...');
            await client.query(`
                ALTER TABLE daily_task_instances 
                ADD COLUMN IF NOT EXISTS duration_minutes INTEGER
            `);
        }

        if (!instanceColumns.includes('notes')) {
            console.log('Adding notes column...');
            await client.query(`
                ALTER TABLE daily_task_instances 
                ADD COLUMN IF NOT EXISTS notes TEXT
            `);
        }

        // Create indexes
        console.log('Creating indexes...');
        await client.query(`CREATE INDEX IF NOT EXISTS idx_staff_role ON staff(role)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_staff_active ON staff(active)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_task_templates_role ON task_templates(role)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_daily_instances_date ON daily_task_instances(task_date)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_daily_instances_staff ON daily_task_instances(staff_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_daily_instances_status ON daily_task_instances(status)`);

        // Insert sample staff if none exist
        const staffCount = await client.query('SELECT COUNT(*) FROM staff');
        if (parseInt(staffCount.rows[0].count) === 0) {
            console.log('Inserting sample staff...');
            const staff = [
                { name: 'Tech Station 1', role: 'technician', employee_id: 'TECH001' },
                { name: 'Tech Station 2', role: 'technician', employee_id: 'TECH002' },
                { name: 'Tech Station 3', role: 'technician', employee_id: 'TECH003' },
                { name: 'Packer Station 1', role: 'packer', employee_id: 'PACK001' },
                { name: 'Packer Station 2', role: 'packer', employee_id: 'PACK002' },
            ];

            for (const member of staff) {
                await client.query(
                    'INSERT INTO staff (name, role, employee_id) VALUES ($1, $2, $3) ON CONFLICT (employee_id) DO NOTHING',
                    [member.name, member.role, member.employee_id]
                );
            }
        }

        // SKU Management Table
        console.log('Creating sku_management table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS sku_management (
                id SERIAL PRIMARY KEY,
                base_sku VARCHAR(100) NOT NULL UNIQUE,
                current_sku_counting VARCHAR(10) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_sku_management_base_sku ON sku_management(base_sku)
        `);

        // Completed Tasks Archive Table
        console.log('Creating completed_tasks table...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS completed_tasks (
                id SERIAL PRIMARY KEY,
                template_id INTEGER NOT NULL,
                staff_id INTEGER REFERENCES staff(id) ON DELETE CASCADE,
                task_title TEXT NOT NULL,
                task_description TEXT,
                role VARCHAR(50) NOT NULL,
                station_id VARCHAR(50),
                order_number VARCHAR(100),
                tracking_number VARCHAR(100),
                completed_at TIMESTAMP NOT NULL,
                completed_by VARCHAR(100),
                duration_minutes INTEGER,
                notes TEXT,
                original_created_at TIMESTAMP,
                restored_at TIMESTAMP
            )
        `);
        
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_completed_tasks_staff ON completed_tasks(staff_id)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_completed_tasks_station ON completed_tasks(station_id)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_completed_tasks_completed_at ON completed_tasks(completed_at)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_completed_tasks_template ON completed_tasks(template_id)
        `);

        await client.query('COMMIT');

        return NextResponse.json({ 
            success: true, 
            message: 'Database setup completed successfully!' 
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Database setup error:', error);
        return NextResponse.json({ 
            success: false, 
            error: 'Database setup failed', 
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    } finally {
        client.release();
    }
}

