import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCarrier } from '@/utils/tracking';
import { formatPSTTimestamp } from '@/lib/timezone';
import { resolveReceivingSchema } from '@/utils/receiving-schema';
import { createCacheLookupKey, getCachedJson, invalidateCacheTags, setCachedJson } from '@/lib/cache/upstash-cache';

// POST - Add entry to receiving table
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { trackingNumber, carrier: providedCarrier } = body;

        if (!trackingNumber) {
            return NextResponse.json({ 
                error: 'trackingNumber is required' 
            }, { status: 400 });
        }

        // Auto-detect carrier if not provided or set to Unknown
        const detectedCarrier = providedCarrier && providedCarrier !== 'Unknown' 
            ? providedCarrier 
            : getCarrier(trackingNumber);

        // Always stamp on the server in PST/PDT to avoid client timezone drift.
        const now = formatPSTTimestamp();
        
        const { dateColumn } = await resolveReceivingSchema();
        await pool.query(
            `INSERT INTO receiving (${dateColumn}, receiving_tracking_number, carrier)
             VALUES ($1, $2, $3)`,
            [now, trackingNumber, detectedCarrier]
        );
        await invalidateCacheTags(['receiving-logs']);

        return NextResponse.json({
            success: true,
            message: 'Entry added to receiving table',
            carrier: detectedCarrier,
            timestamp: now
        }, { status: 201 });
    } catch (error) {
        console.error('Error adding receiving entry:', error);
        return NextResponse.json({ 
            error: 'Failed to add receiving entry',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}

// GET - Fetch all receiving logs
export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const cacheLookup = createCacheLookupKey({ limit, offset });

    try {
        const cached = await getCachedJson<any[]>('api:receiving-entry', cacheLookup);
        if (cached) {
            return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });
        }

        const { dateColumn, hasQuantity } = await resolveReceivingSchema();
        const countExpr = hasQuantity ? "COALESCE(quantity, '1')" : "'1'";
        const result = await pool.query(
            `SELECT
                id,
                ${dateColumn} AS timestamp,
                receiving_tracking_number AS tracking,
                carrier,
                ${countExpr} AS quantity
             FROM receiving
             WHERE receiving_tracking_number IS NOT NULL AND receiving_tracking_number != ''
             ORDER BY id DESC
             LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
            
        await setCachedJson('api:receiving-entry', cacheLookup, result.rows, 30, ['receiving-logs']);
        return NextResponse.json(result.rows, { headers: { 'x-cache': 'MISS' } });
    } catch (error) {
        console.error('Error fetching receiving logs:', error);
        return NextResponse.json({ 
            error: 'Failed to fetch receiving logs',
            details: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
