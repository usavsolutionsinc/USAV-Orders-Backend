import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function GET() {
    try {
        // Test existing pg pool connection
        const result = await pool.query('SELECT NOW()');
        
        return NextResponse.json({
            success: true,
            message: 'Database connection successful',
            timestamp: result.rows[0].now,
            database_url_set: !!process.env.DATABASE_URL,
            connection_type: 'pg Pool'
        });
    } catch (error) {
        return NextResponse.json({
            success: false,
            error: 'Database connection failed',
            details: error instanceof Error ? error.message : 'Unknown error',
            database_url_set: !!process.env.DATABASE_URL,
            env_check: {
                DATABASE_URL: process.env.DATABASE_URL ? 'SET (hidden)' : 'NOT SET'
            }
        }, { status: 500 });
    }
}

