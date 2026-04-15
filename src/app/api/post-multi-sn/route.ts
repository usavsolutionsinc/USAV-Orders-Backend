import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { formatPSTTimestamp } from '@/utils/date';
import { getSkuCatalogBySku } from '@/lib/neon/sku-catalog-queries';
import { publishStockLedgerEvent } from '@/lib/realtime/publish';

export async function POST(request: NextRequest) {
    const client = await pool.connect();
    try {
        const body = await request.json();
        const { sku, serialNumbers, notes, productTitle: _productTitle, location, shippingTrackingNumber } = body;

        if (!sku || !serialNumbers || !Array.isArray(serialNumbers) || serialNumbers.length === 0) {
            return NextResponse.json({ error: 'Missing required fields: sku and serialNumbers[]' }, { status: 400 });
        }

        const timestamp = formatPSTTimestamp(new Date());
        const skuStr = String(sku).trim();
        const trackingStr = shippingTrackingNumber ? String(shippingTrackingNumber).trim() : null;
        const notesStr = notes ? String(notes) : null;
        const locationStr = location ? String(location).trim() : null;

        const catalog = await getSkuCatalogBySku(skuStr);
        const catalogId = catalog?.id ?? null;

        await client.query('BEGIN');

        const insertedIds: number[] = [];
        let newSerialCount = 0; // only newly-created rows count toward stock delta
        for (const raw of serialNumbers) {
            const serial = String(raw || '').trim();
            if (!serial) continue;
            const normalized = serial.toUpperCase();

            const result = await client.query<{ id: number; was_insert: boolean }>(
                `INSERT INTO serial_units (
                    serial_number, normalized_serial, sku, sku_catalog_id,
                    current_status, current_location,
                    origin_source, shipping_tracking_number,
                    legacy_notes, legacy_date_time
                 )
                 VALUES ($1, $2, $3, $4, 'UNKNOWN'::serial_status_enum, $5, 'sku', $6, $7, $8)
                 ON CONFLICT (normalized_serial) DO UPDATE SET
                    sku                      = COALESCE(serial_units.sku, EXCLUDED.sku),
                    sku_catalog_id           = COALESCE(serial_units.sku_catalog_id, EXCLUDED.sku_catalog_id),
                    current_location         = COALESCE(EXCLUDED.current_location, serial_units.current_location),
                    shipping_tracking_number = COALESCE(EXCLUDED.shipping_tracking_number, serial_units.shipping_tracking_number),
                    legacy_notes             = COALESCE(EXCLUDED.legacy_notes, serial_units.legacy_notes),
                    legacy_date_time         = COALESCE(serial_units.legacy_date_time, EXCLUDED.legacy_date_time),
                    updated_at               = NOW()
                 RETURNING id, (xmax = 0) AS was_insert`,
                [serial, normalized, skuStr, catalogId, locationStr, trackingStr, notesStr, timestamp],
            );
            const row = result.rows[0];
            if (row?.id) insertedIds.push(row.id);
            if (row?.was_insert) newSerialCount += 1;
        }

        // Emit a single RECEIVED delta covering only truly-new serials. Trigger
        // fn_recompute_sku_stock updates sku_stock.stock automatically.
        let ledgerId: number | null = null;
        if (newSerialCount > 0) {
            const ledgerInsert = await client.query<{ id: number }>(
                `INSERT INTO sku_stock_ledger (sku, delta, reason, dimension, notes)
                 VALUES ($1, $2, 'RECEIVED', 'WAREHOUSE', $3)
                 RETURNING id`,
                [skuStr, newSerialCount, `post-multi-sn: ${newSerialCount} serial(s) registered`],
            );
            ledgerId = ledgerInsert.rows[0]?.id ?? null;
        }

        await client.query('COMMIT');

        if (ledgerId) {
            try {
                await publishStockLedgerEvent({
                    ledgerId,
                    sku: skuStr,
                    delta: newSerialCount,
                    reason: 'RECEIVED',
                    dimension: 'WAREHOUSE',
                    source: 'post-multi-sn',
                });
            } catch (err) {
                console.warn('[post-multi-sn] realtime publish failed', err);
            }
        }

        return NextResponse.json({
            success: true,
            serialUnitIds: insertedIds,
            // Preserve legacy response shape — first id used by some callers as the "row id"
            id: insertedIds[0] ?? null,
        });
    } catch (error: any) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('[post-multi-sn] DB error:', error);
        return NextResponse.json(
            { error: 'Internal Server Error', details: error.message },
            { status: 500 }
        );
    } finally {
        client.release();
    }
}
