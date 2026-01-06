import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        console.log('Creating receiving_tasks table...');

        // Create receiving_tasks table
        await client.query(`
            CREATE TABLE IF NOT EXISTS receiving_tasks (
                id SERIAL PRIMARY KEY,
                tracking_number VARCHAR(100) NOT NULL,
                order_number VARCHAR(100),
                status VARCHAR(20) DEFAULT 'pending',
                urgent BOOLEAN DEFAULT false,
                received_date TIMESTAMP,
                processed_date TIMESTAMP,
                notes TEXT,
                staff_id INTEGER REFERENCES staff(id) ON DELETE SET NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create indexes
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_receiving_tasks_tracking ON receiving_tasks(tracking_number)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_receiving_tasks_status ON receiving_tasks(status)
        `);
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_receiving_tasks_urgent ON receiving_tasks(urgent)
        `);

        console.log('✓ Created receiving_tasks table with indexes');

        await client.query('COMMIT');

        return NextResponse.json({ 
            success: true, 
            message: 'Receiving tasks table created successfully!',
            table: 'receiving_tasks',
            columns: [
                'id (SERIAL PRIMARY KEY)',
                'tracking_number (VARCHAR 100)',
                'order_number (VARCHAR 100, optional)',
                'status (VARCHAR 20, default: pending)',
                'urgent (BOOLEAN, default: false)',
                'received_date (TIMESTAMP)',
                'processed_date (TIMESTAMP)',
                'notes (TEXT)',
                'staff_id (INTEGER, FK to staff)',
                'created_at (TIMESTAMP)'
            ]
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Database setup error:', error);
        return NextResponse.json({ 
            success: false, 
            error: 'Failed to create receiving_tasks table', 
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    } finally {
        client.release();
    }
}

// GET endpoint to verify table exists
export async function GET() {
    try {
        const result = await pool.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'receiving_tasks' 
            ORDER BY ordinal_position
        `);

        const count = await pool.query('SELECT COUNT(*) FROM receiving_tasks');

        return NextResponse.json({
            success: true,
            table: 'receiving_tasks',
            exists: result.rows.length > 0,
            columns: result.rows,
            row_count: parseInt(count.rows[0].count)
        });
    } catch (error) {
        console.error('Error checking table:', error);
        return NextResponse.json({ 
            success: false, 
            error: 'Failed to check table',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}

