import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(request: NextRequest) {
    const client = await pool.connect();
    try {
        const body = await request.json();
        const { sku, location } = body;

        if (!sku || location === undefined) {
            return NextResponse.json({ error: 'Missing sku or location' }, { status: 400 });
        }

        const skuStr = String(sku).trim();
        const locationStr = String(location).trim();

        await client.query('BEGIN');

        // Capture prior location first, then UPDATE, so the audit row has the right from_location.
        const stock = await client.query<{ id: number; prior: string | null }>(
            `WITH prior AS (SELECT id, location FROM sku_stock WHERE sku = $2)
             UPDATE sku_stock ss
             SET location = $1
             FROM prior
             WHERE ss.id = prior.id
             RETURNING ss.id, prior.location AS prior`,
            [locationStr, skuStr],
        );

        let stockId: number | null = stock.rows[0]?.id ?? null;
        const priorLocation: string | null = stock.rows[0]?.prior ?? null;

        // No stock row yet — create one so the location lands somewhere.
        if (!stockId) {
            const inserted = await client.query<{ id: number }>(
                `INSERT INTO sku_stock (sku, location, stock)
                 VALUES ($1, $2, 0)
                 ON CONFLICT (sku) DO UPDATE SET location = EXCLUDED.location
                 RETURNING id`,
                [skuStr, locationStr],
            );
            stockId = inserted.rows[0]?.id ?? null;
        }

        // Audit row so the change is visible in the transfer log.
        if (stockId) {
            await client.query(
                `INSERT INTO location_transfers (entity_type, entity_id, sku, from_location, to_location, notes)
                 VALUES ('SKU_STOCK', $1, $2, $3, $4, $5)`,
                [stockId, skuStr, priorLocation, locationStr, 'Location updated via Change Location mode'],
            );
        }

        await client.query('COMMIT');
        return NextResponse.json({ success: true });
    } catch (error: any) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Update location error:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    } finally {
        client.release();
    }
}
