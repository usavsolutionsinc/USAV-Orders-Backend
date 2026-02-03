import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST() {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');

        console.log('Creating source of truth tables...');

        // Helper function to generate column definitions
        const generateColumns = (totalColumns: number): string => {
            const columns = ['col_1 SERIAL PRIMARY KEY'];
            for (let i = 2; i <= totalColumns; i++) {
                columns.push(`col_${i} TEXT`);
            }
            return columns.join(', ');
        };

        // Helper function to create table
        const createTable = async (tableName: string, columnCount: number) => {
            const columns = generateColumns(columnCount);
            await client.query(`
                CREATE TABLE IF NOT EXISTS ${tableName} (
                    ${columns}
                )
            `);
            console.log(`✓ Created table: ${tableName} (${columnCount} columns)`);
        };

        // 1. orders
        await client.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                ship_by_date TEXT,
                order_id TEXT,
                product_title TEXT,
                quantity TEXT,
                sku TEXT,
                condition TEXT,
                shipping_tracking_number TEXT,
                days_late TEXT,
                out_of_stock TEXT,
                notes TEXT,
                assigned_to TEXT,
                status TEXT NOT NULL DEFAULT 'unassigned',
                urgent TEXT
            )
        `);

        // 2-5. tech_1 through tech_4
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
        }

        // 6-8. packer_1 through packer_3
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
        }

        // 9. receiving
        await client.query(`
            CREATE TABLE IF NOT EXISTS receiving (
                id SERIAL PRIMARY KEY,
                date_time TEXT,
                receiving_tracking_number TEXT,
                carrier TEXT,
                quantity TEXT
            )
        `);

        // 10. shipped
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

        // 11. sku_stock
        await client.query(`
            CREATE TABLE IF NOT EXISTS sku_stock (
                id SERIAL PRIMARY KEY,
                stock TEXT,
                sku TEXT,
                size TEXT,
                product_title TEXT
            )
        `);

        // 12. sku
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

        // 13. repair_service
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

        // Create indexes on primary keys
        console.log('Creating indexes...');
        const tables = [
            'orders', 'tech_1', 'tech_2', 'tech_3', 'tech_4',
            'packer_1', 'packer_2', 'packer_3', 'receiving',
            'shipped', 'sku_stock', 'sku', 'repair_service'
        ];

        for (const table of tables) {
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_${table}_id ON ${table}(id)
            `);
        }

        await client.query('COMMIT');

        return NextResponse.json({ 
            success: true, 
            message: 'Source of truth database setup completed successfully!',
            tables_created: 13,
            details: {
                orders: 'Explicit columns',
                tech_stations: '4 tables, explicit columns',
                packer_stations: '3 tables, explicit columns',
                receiving: 'Explicit columns',
                shipped: 'Explicit columns',
                sku_stock: 'Explicit columns',
                sku: 'Explicit columns',
                repair_service: 'Explicit columns'
            }
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

// GET endpoint to verify tables exist
export async function GET() {
    try {
        const tables = [
            'orders', 'tech_1', 'tech_2', 'tech_3', 'tech_4',
            'packer_1', 'packer_2', 'packer_3', 'receiving',
            'shipped', 'sku_stock', 'sku', 'repair_service'
        ];

        const tableInfo = [];

        for (const table of tables) {
            const result = await pool.query(`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = $1 
                ORDER BY ordinal_position
            `, [table]);

            tableInfo.push({
                table: table,
                columns: result.rows,
                column_count: result.rows.length,
                exists: result.rows.length > 0
            });
        }

        return NextResponse.json({
            success: true,
            tables: tableInfo,
            total_tables: tables.length
        });
    } catch (error) {
        console.error('Error checking tables:', error);
        return NextResponse.json({ 
            success: false, 
            error: 'Failed to check tables',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}

