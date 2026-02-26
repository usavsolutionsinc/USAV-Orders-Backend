import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';
import { upsertOpenOrderException } from '@/lib/orders-exceptions';
import { checkRateLimit } from '@/lib/api-guard';

const FBA_LIKE_RE = /^(X00|X0|B0|FBA)/i;

async function hasMatchingFbaFnsku(fnsku: string, dbClient: { query: (text: string, params?: any[]) => Promise<{ rows: any[] }> } = pool): Promise<boolean> {
    const normalized = String(fnsku || '').trim().toUpperCase();
    if (!normalized) return false;

    try {
        const primary = await dbClient.query(
            `SELECT 1
             FROM fba_fnskus
             WHERE UPPER(TRIM(COALESCE(fnsku, ''))) = $1
             LIMIT 1`,
            [normalized]
        );
        if (primary.rows.length > 0) return true;
    } catch (err: any) {
        if (err?.code !== '42P01') {
            throw err;
        }
    }

    try {
        const fallback = await dbClient.query(
            `SELECT 1
             FROM fba_fnsku
             WHERE UPPER(TRIM(COALESCE(fnsku, ''))) = $1
             LIMIT 1`,
            [normalized]
        );
        return fallback.rows.length > 0;
    } catch (err: any) {
        if (err?.code === '42P01') return false;
        throw err;
    }
}

export async function POST(req: NextRequest) {
    const rate = checkRateLimit({
        headers: req.headers,
        routeKey: 'tech-scan-tracking',
        limit: 120,
        windowMs: 60_000,
    });
    if (!rate.ok) {
        return NextResponse.json(
            { success: false, found: false, error: 'Rate limit exceeded. Please retry shortly.' },
            { status: 429, headers: rate.retryAfterSec ? { 'Retry-After': String(rate.retryAfterSec) } : undefined }
        );
    }

    const rawBody = await req.text();
    if (!rawBody?.trim()) {
        return NextResponse.json({ success: false, found: false, error: 'Request body is required' }, { status: 400 });
    }

    let parsed: { tracking?: string; techId?: string | number };
    try {
        parsed = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ success: false, found: false, error: 'Invalid JSON body' }, { status: 400 });
    }
    const tracking = String(parsed.tracking || '').trim();
    const techId = String(parsed.techId || '').trim();

    if (!tracking) {
        return NextResponse.json({ success: false, found: false, error: 'Tracking number is required' }, { status: 400 });
    }

    if (!techId) {
        return NextResponse.json({ success: false, found: false, error: 'Tech ID is required' }, { status: 400 });
    }

    try {
        const scannedTracking = String(tracking || '').trim();
        const key18 = normalizeTrackingKey18(scannedTracking);
        if (!key18) {
            return NextResponse.json({ success: false, found: false, error: 'Invalid tracking number' }, { status: 400 });
        }
        const techIdNum = parseInt(techId, 10);
        if (!techIdNum) {
            return NextResponse.json({ success: false, found: false, error: 'Invalid Tech ID' }, { status: 400 });
        }

        const parseSerials = (value: string | null | undefined) =>
            String(value || '')
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);

        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const staffResult = await client.query(
                `SELECT id, name FROM staff WHERE id = $1 LIMIT 1`,
                [techIdNum]
            );
            if (staffResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return NextResponse.json({ success: false, found: false, error: 'Tech not found in staff table' }, { status: 404 });
            }
            const testedBy = staffResult.rows[0].id;
            const testedByName = staffResult.rows[0].name || null;

            // Query orders table by tracking first so active order always has product info
            const result = await client.query(`
                SELECT 
                    id,
                    order_id,
                    product_title,
                    item_number,
                    sku,
                    condition,
                    notes,
                    shipping_tracking_number,
                    account_source,
                    status,
                    status_history,
                    is_shipped,
                    packer_id,
                    tester_id,
                    out_of_stock,
                    ship_by_date,
                    order_date,
                    created_at,
                    quantity
                FROM orders
                WHERE RIGHT(regexp_replace(UPPER(shipping_tracking_number), '[^A-Z0-9]', '', 'g'), 18) = $1
                  AND shipping_tracking_number IS NOT NULL
                  AND shipping_tracking_number != ''
                LIMIT 1
            `, [key18]);

            // Check tech_serial_numbers for existing tracking entry
            const existingTracking = await client.query(
                `SELECT id, shipping_tracking_number, serial_number
                 FROM tech_serial_numbers
                 WHERE RIGHT(regexp_replace(UPPER(shipping_tracking_number), '[^A-Z0-9]', '', 'g'), 18) = $1
                 LIMIT 1`,
                [key18]
            );

            const row = result.rows[0] || null;
            const trackingValue =
                row?.shipping_tracking_number ||
                existingTracking.rows[0]?.shipping_tracking_number ||
                scannedTracking;

            if (!row) {
                const isFbaLikeTracking = FBA_LIKE_RE.test(scannedTracking);
                const fnskuFound = isFbaLikeTracking
                    ? await hasMatchingFbaFnsku(scannedTracking, client)
                    : false;

                if (!isFbaLikeTracking || !fnskuFound) {
                    await upsertOpenOrderException({
                        shippingTrackingNumber: scannedTracking,
                        sourceStation: 'tech',
                        staffId: testedBy,
                        staffName: testedByName,
                        reason: 'not_found',
                        notes: isFbaLikeTracking
                            ? 'Tech scan: FNSKU not found in fba_fnskus'
                            : 'Tech scan: tracking not found in orders',
                    }, client);
                }

                const exactTrackingRow = await client.query(
                    `SELECT id, serial_number
                     FROM tech_serial_numbers
                     WHERE shipping_tracking_number = $1
                     ORDER BY id ASC
                     LIMIT 1`,
                    [scannedTracking]
                );

                if (exactTrackingRow.rows.length === 0) {
                    await client.query(
                        `INSERT INTO tech_serial_numbers (
                            shipping_tracking_number, serial_number, test_date_time, tested_by
                        ) VALUES ($1, $2, date_trunc('second', NOW()), $3)`,
                        [scannedTracking, '', testedBy]
                    );
                }
                const serialSource =
                    exactTrackingRow.rows[0]?.serial_number ??
                    existingTracking.rows[0]?.serial_number ??
                    '';

                await client.query('COMMIT');
                return NextResponse.json({
                    success: true,
                    found: true,
                    orderFound: false,
                    warning: (!isFbaLikeTracking || !fnskuFound)
                        ? 'Tracking number not found in orders. Added to exceptions.'
                        : 'FBA/FNSKU processed without exception.',
                    order: {
                        id: null,
                        orderId: 'N/A',
                        productTitle: 'Unknown Product',
                        itemNumber: null,
                        sku: 'N/A',
                        condition: 'N/A',
                        notes: 'Tracking recorded in orders_exceptions for reconciliation',
                        tracking: scannedTracking,
                        serialNumbers: parseSerials(serialSource),
                        testDateTime: null,
                        testedBy,
                        accountSource: null,
                        quantity: 1,
                        status: null,
                        statusHistory: [],
                        isShipped: false,
                        packerId: null,
                        testerId: null,
                        outOfStock: null,
                        shipByDate: null,
                        orderDate: null,
                        createdAt: null
                    }
                });
            }

            // Create tracking row once if missing. This is the single row that serial scans append to.
            if (existingTracking.rows.length === 0) {
                await client.query(
                    `INSERT INTO tech_serial_numbers (
                        shipping_tracking_number, serial_number, test_date_time, tested_by
                    ) VALUES ($1, $2, date_trunc('second', NOW()), $3)`,
                    [trackingValue, '', testedBy]
                );
            }
            const serialNumbers = parseSerials(existingTracking.rows[0]?.serial_number);

            await client.query('COMMIT');
            return NextResponse.json({
                success: true,
                found: true,
                orderFound: true,
                order: {
                    id: row.id,
                    orderId: row.order_id || 'N/A',
                    productTitle: row.product_title || 'Unknown Product',
                    itemNumber: row.item_number || null,
                    sku: row.sku || 'N/A',
                    condition: row.condition || 'N/A',
                    notes: row.notes || '',
                    tracking: trackingValue,
                    serialNumbers,
                    testDateTime: null,
                    testedBy,
                    accountSource: row.account_source || null,
                    quantity: row.quantity || 1,
                    status: row.status || null,
                    statusHistory: row.status_history || [],
                    isShipped: row.is_shipped || false,
                    packerId: row.packer_id || null,
                    testerId: row.tester_id || null,
                    outOfStock: row.out_of_stock || null,
                    shipByDate: row.ship_by_date || null,
                    orderDate: row.order_date || null,
                    createdAt: row.created_at || null
                }
            });
        } catch (txError) {
            await client.query('ROLLBACK');
            throw txError;
        } finally {
            client.release();
        }
    } catch (error: any) {
        console.error('Error scanning tracking:', error);
        return NextResponse.json({
            success: false,
            found: false,
            error: 'Failed to scan tracking',
            details: error.message
        }, { status: 500 });
    }
}

export async function GET() {
    return NextResponse.json({
        success: false,
        error: 'Method not allowed. Use POST /api/tech/scan-tracking'
    }, { status: 405 });
}
