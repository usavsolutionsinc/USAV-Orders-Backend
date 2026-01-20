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

        // 1. orders - 10 columns
        await createTable('orders', 10);

        // 2-5. tech_1 through tech_4 - 7 columns each
        await createTable('tech_1', 7);
        await createTable('tech_2', 7);
        await createTable('tech_3', 7);
        await createTable('tech_4', 7);

        // 6-8. packer_1 through packer_3 - 5 columns each
        await createTable('packer_1', 5);
        await createTable('packer_2', 5);
        await createTable('packer_3', 5);

        // 9. receiving - 5 columns
        await createTable('receiving', 5);

        // 10. shipped - 10 columns
        await createTable('shipped', 10);

        // 11. sku_stock - 5 columns (using underscore instead of dash)
        await createTable('sku_stock', 5);

        // 12. sku - 8 columns with specific names
        console.log('Creating table: sku (8 columns)...');
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
        console.log('✓ Created table: sku');

        // 13. rs - 10 columns
        await createTable('rs', 10);

        // Create indexes on primary keys (automatically created, but explicit for clarity)
        console.log('Creating indexes...');
        const tables = [
            'orders', 'tech_1', 'tech_2', 'tech_3', 'tech_4',
            'packer_1', 'packer_2', 'packer_3', 'receiving',
            'shipped', 'sku_stock', 'sku', 'rs'
        ];

        for (const table of tables) {
            const pkColumn = table === 'sku' ? 'id' : 'col_1';
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_${table}_${pkColumn} ON ${table}(${pkColumn})
            `);
        }

        await client.query('COMMIT');

        return NextResponse.json({ 
            success: true, 
            message: 'Source of truth database setup completed successfully!',
            tables_created: 13,
            details: {
                orders: '10 columns',
                tech_1: '7 columns',
                tech_2: '7 columns',
                tech_3: '7 columns',
                tech_4: '7 columns',
                packer_1: '5 columns',
                packer_2: '5 columns',
                packer_3: '5 columns',
                receiving: '5 columns',
                shipped: '10 columns',
                sku_stock: '5 columns',
                sku: '8 columns',
                rs: '10 columns'
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
            'shipped', 'sku_stock', 'sku', 'rs'
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

