import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: packerId } = await params;
        const tableName = `Packer_${packerId}`;
        
        const client = await pool.connect();
        try {
            // Select all col_* columns except id and created_at, plus id for keyField
            // Use parameterized query with table name (PostgreSQL doesn't support table name parameters, so we validate)
            if (!/^Packer_[1-3]$/.test(tableName)) {
                return NextResponse.json({ error: 'Invalid packer ID' }, { status: 400 });
            }
            
            const result = await client.query(`
                SELECT id, col_1, col_2, col_3, col_4, col_5
                FROM ${tableName}
                ORDER BY created_at DESC 
                LIMIT 500
            `);
            return NextResponse.json(result.rows);
        } finally {
            client.release();
        }
    } catch (error: any) {
        console.error('Database Error:', error);
        return NextResponse.json({ error: 'Failed to fetch packer data' }, { status: 500 });
    }
}

