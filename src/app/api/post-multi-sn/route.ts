import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { formatPSTTimestamp } from '@/utils/date';
import { getSkuCatalogBySku } from '@/lib/neon/sku-catalog-queries';

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
        const baseSku = skuStr.includes(':') ? skuStr.split(':')[0].trim() : skuStr;
        const trackingStr = shippingTrackingNumber ? String(shippingTrackingNumber).trim() : null;
        const notesStr = notes ? String(notes) : null;
        const locationStr = location ? String(location).trim() : null;

        const catalog = await getSkuCatalogBySku(baseSku) ?? await getSkuCatalogBySku(skuStr);
        const catalogId = catalog?.id ?? null;

        await client.query('BEGIN');

        const insertedIds: number[] = [];
        for (const raw of serialNumbers) {
            const serial = String(raw || '').trim();
            if (!serial) continue;
            const normalized = serial.toUpperCase();

            const result = await client.query<{ id: number }>(
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
                 RETURNING id`,
                [serial, normalized, skuStr, catalogId, locationStr, trackingStr, notesStr, timestamp],
            );
            if (result.rows[0]?.id) insertedIds.push(result.rows[0].id);
        }

        await client.query('COMMIT');

        return NextResponse.json({
            success: true,
            serialUnitIds: insertedIds,
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
