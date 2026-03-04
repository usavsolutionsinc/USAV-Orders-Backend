import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getCarrier } from '@/utils/tracking';
import { formatPSTTimestamp } from '@/lib/timezone';
import { resolveReceivingSchema } from '@/utils/receiving-schema';
import { createCacheLookupKey, getCachedJson, invalidateCacheTags, setCachedJson } from '@/lib/cache/upstash-cache';

/**
 * Compute Mon–Fri week range (PST date strings) for a given PST timestamp string
 * such as '2026-03-04T14:30:00'.  Used to target the exact Redis cache key that
 * ReceivingLogs uses when fetching by week.
 */
function getPSTWeekRange(pstTimestamp: string): { startStr: string; endStr: string } {
    const dateKey = pstTimestamp.substring(0, 10); // 'YYYY-MM-DD'
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    const dow = date.getDay(); // 0=Sun
    const daysFromMonday = dow === 0 ? 6 : dow - 1;
    const monday = new Date(date);
    monday.setDate(date.getDate() - daysFromMonday);
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);
    const fmt = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return { startStr: fmt(monday), endStr: fmt(friday) };
}

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

        const detectedCarrier = providedCarrier && providedCarrier !== 'Unknown' 
            ? providedCarrier 
            : getCarrier(trackingNumber);

        // Always stamp on the server in PST/PDT to avoid client timezone drift.
        const now = formatPSTTimestamp();
        
        const { dateColumn } = await resolveReceivingSchema();
        const inserted = await pool.query(
            `INSERT INTO receiving (${dateColumn}, receiving_tracking_number, carrier)
             VALUES ($1, $2, $3)
             RETURNING id`,
            [now, trackingNumber, detectedCarrier]
        );

        const newRecord = {
            id: String(inserted.rows[0].id),
            timestamp: now,
            tracking: trackingNumber,
            status: detectedCarrier,
            count: 1,
        };

        // Surgical Redis cache update: prepend the single new record to the
        // current week's cached array instead of invalidating and re-querying.
        // If that week isn't cached yet the next regular fetch will populate it.
        const weekRange = getPSTWeekRange(now);
        const weekCacheKey = createCacheLookupKey({
            limit: 500,
            offset: 0,
            weekStart: weekRange.startStr,
            weekEnd: weekRange.endStr,
        });
        const existing = await getCachedJson<any[]>('api:receiving-logs', weekCacheKey);
        if (Array.isArray(existing)) {
            await setCachedJson(
                'api:receiving-logs',
                weekCacheKey,
                [newRecord, ...existing].slice(0, 500),
                120,          // current-week TTL: 2 min
                ['receiving-logs'],
            );
        }

        return NextResponse.json({ success: true, record: newRecord }, { status: 201 });
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
