import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { resolveReceivingSchema } from '@/utils/receiving-schema';
import { createCacheLookupKey, getCachedJson, invalidateCacheTags, setCachedJson } from '@/lib/cache/upstash-cache';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const limit = parseInt(searchParams.get('limit') || '50');
        const offset = parseInt(searchParams.get('offset') || '0');
        const cacheLookup = createCacheLookupKey({ limit, offset });

        const cached = await getCachedJson<any[]>('api:receiving-logs', cacheLookup);
        if (cached) {
            return NextResponse.json(cached, { headers: { 'x-cache': 'HIT' } });
        }

        const tableCheck = await pool.query(
            `SELECT EXISTS (
                SELECT FROM information_schema.tables
                WHERE table_name = 'receiving'
            ) AS exists`
        );
        if (!tableCheck.rows[0]?.exists) {
            return NextResponse.json([], { headers: { 'x-cache': 'MISS' } });
        }

        const { dateColumn, hasQuantity } = await resolveReceivingSchema();
        const countExpr = hasQuantity ? "COALESCE(quantity, '1')" : "'1'";

        const logs = await pool.query(`
            SELECT id, ${dateColumn} AS timestamp, receiving_tracking_number AS tracking, carrier AS status, ${countExpr} AS count
            FROM receiving
            WHERE receiving_tracking_number IS NOT NULL AND receiving_tracking_number != ''
            ORDER BY id DESC
            LIMIT $1 OFFSET $2
        `, [limit, offset]);

        // Map to StationHistory interface format
        const formattedLogs = logs.rows.map((log: any) => ({
            id: String(log.id),
            timestamp: log.timestamp || '',
            tracking: log.tracking || '',
            status: log.status || '',         // Carrier
            count: parseInt(String(log.count || '1'), 10) || 1,
        }));

        await setCachedJson('api:receiving-logs', cacheLookup, formattedLogs, 30, ['receiving-logs']);
        return NextResponse.json(formattedLogs, { headers: { 'x-cache': 'MISS' } });
    } catch (error: any) {
        console.error('Error fetching receiving logs:', error);
        return NextResponse.json(
            { error: 'Failed to fetch receiving logs', details: error.message },
            { status: 500 }
        );
    }
}

export async function DELETE(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const idRaw = searchParams.get('id');
        const id = Number(idRaw);

        if (!idRaw || !Number.isFinite(id) || id <= 0) {
            return NextResponse.json(
                { error: 'Valid id is required' },
                { status: 400 }
            );
        }

        const result = await pool.query(
            `DELETE FROM receiving WHERE id = $1 RETURNING id`,
            [id]
        );

        if (result.rowCount === 0) {
            return NextResponse.json(
                { error: 'Receiving log not found' },
                { status: 404 }
            );
        }

        await invalidateCacheTags(['receiving-logs']);
        return NextResponse.json({ success: true, id });
    } catch (error: any) {
        console.error('Error deleting receiving log:', error);
        return NextResponse.json(
            { error: 'Failed to delete receiving log', details: error.message },
            { status: 500 }
        );
    }
}

export async function PATCH(request: NextRequest) {
    try {
        const body = await request.json();
        const id = Number(body?.id);
        const tracking = String(body?.tracking ?? '').trim();
        const status = String(body?.status ?? '').trim();
        const countRaw = body?.count;

        if (!Number.isFinite(id) || id <= 0) {
            return NextResponse.json({ error: 'Valid id is required' }, { status: 400 });
        }
        if (!tracking) {
            return NextResponse.json({ error: 'tracking is required' }, { status: 400 });
        }

        const { hasQuantity } = await resolveReceivingSchema();
        const updates: string[] = ['receiving_tracking_number = $1', 'carrier = $2'];
        const values: any[] = [tracking, status || 'Unknown'];
        let idx = 3;

        if (hasQuantity && countRaw !== undefined && countRaw !== null && String(countRaw).trim() !== '') {
            updates.push(`quantity = $${idx++}`);
            values.push(String(countRaw).trim());
        }

        values.push(id);
        const result = await pool.query(
            `UPDATE receiving
             SET ${updates.join(', ')}
             WHERE id = $${idx}
             RETURNING id`,
            values
        );

        if (result.rowCount === 0) {
            return NextResponse.json({ error: 'Receiving log not found' }, { status: 404 });
        }

        await invalidateCacheTags(['receiving-logs']);
        return NextResponse.json({ success: true, id });
    } catch (error: any) {
        console.error('Error updating receiving log:', error);
        return NextResponse.json(
            { error: 'Failed to update receiving log', details: error.message },
            { status: 500 }
        );
    }
}
