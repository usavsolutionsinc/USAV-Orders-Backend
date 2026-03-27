import { NextRequest, NextResponse } from 'next/server';
import { sheets as googleSheets } from '@googleapis/sheets';
import { getGoogleAuth } from '@/lib/google-auth';
import pool from '@/lib/db';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';
import { resolveShipmentId } from '@/lib/shipping/resolve';
import { formatPSTTimestamp, normalizePSTTimestamp } from '@/utils/date';
import {
    ensureOrdersExceptionsTable,
    getTrackingLast8,
    hasFbaFnsku,
    hasOrderByTracking,
    parseSheetDateTime,
    upsertOpenOrdersException,
} from '@/lib/sync/sheet-sync-common';

export const maxDuration = 60;

const DEFAULT_SPREADSHEET_ID = '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';
const FBA_LIKE_RE = /^(X00|X0|B0|FBA)/i;

type SyncResult = {
    sheet: string;
    table: string;
    status: 'synced' | 'error' | 'missing';
    inserted?: number;
    processed?: number;
    directLogs?: number;
    orderLogs?: number;
    skippedExisting?: number;
    skippedMissingTracking?: number;
    exceptionsLogged?: number;
    error?: string;
};

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { action, spreadsheetId } = body;

        if (action !== 'sync_all') {
            return NextResponse.json({ error: 'Invalid action. Only sync_all is supported.' }, { status: 400 });
        }

        const targetSpreadsheetId = spreadsheetId || process.env.SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;
        const auth = getGoogleAuth();
        const sheets = googleSheets({ version: 'v4', auth });

        const spreadsheet = await sheets.spreadsheets.get({
            spreadsheetId: targetSpreadsheetId,
        });
        const existingSheetNames = spreadsheet.data.sheets?.map(s => s.properties?.title || '') || [];

        const client = await pool.connect();
        const results: SyncResult[] = [];

        try {
            const shippedResult = await syncShippedSheet({
                client,
                sheets,
                spreadsheetId: targetSpreadsheetId,
                existingSheetNames,
            });
            results.push(shippedResult);

            const techResults = await syncTechSheets({
                client,
                sheets,
                spreadsheetId: targetSpreadsheetId,
                existingSheetNames,
            });
            results.push(...techResults);

            const packerResults = await syncPackerSheets({
                client,
                sheets,
                spreadsheetId: targetSpreadsheetId,
                existingSheetNames,
            });
            results.push(...packerResults);

        } finally {
            client.release();
        }

        const hasErrors = results.some(r => r.status === 'error');

        return NextResponse.json({
            success: !hasErrors,
            message: hasErrors
                ? 'Sync completed with errors'
                : 'Synced shipped, tech, and packer sheets to Neon DB',
            results,
            timestamp: formatPSTTimestamp(),
        }, { status: hasErrors ? 500 : 200 });
    } catch (error: any) {
        console.error('Sync error:', error);
        return NextResponse.json({
            success: false,
            error: 'Internal Server Error',
            details: error.message,
        }, { status: 500 });
    }
}

async function syncShippedSheet(params: {
    client: any;
    sheets: any;
    spreadsheetId: string;
    existingSheetNames: string[];
}): Promise<SyncResult> {
    const { client, sheets, spreadsheetId, existingSheetNames } = params;
    const sheetName = existingSheetNames.find(s => s.toLowerCase() === 'shipped');

    if (!sheetName) {
        return {
            sheet: 'shipped',
            table: 'orders',
            status: 'missing',
        };
    }

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A2:L`,
        });

        const rows = response.data.values || [];

        const packerNameMap: Record<string, number> = {
            tuan: 4,
            thuy: 5,
        };

        const techNameMap: Record<string, number> = {
            mike: 1,
            thuc: 2,
            sang: 3,
        };

        let inserted = 0;
        let skippedExisting = 0;
        let skippedMissingTracking = 0;

        for (const row of rows) {
            const orderId = row[1] || null;             // B
            const productTitle = row[2] || null;        // C
            const quantity = row[3] || '1';             // D
            const condition = row[4] || null;           // E
            const shippingTracking = String(row[5] || '').trim(); // F
            const packerName = row[7] || null;          // H
            const techName = row[8] || null;            // I
            const rawShipByDate = row[9] || null;       // J
            const sku = row[10] || null;                // K
            const notes = row[11] || null;              // L

            if (!shippingTracking) {
                skippedMissingTracking++;
                continue;
            }

            const existingOrder = await client.query(
                `SELECT o.id FROM orders o
                 JOIN shipping_tracking_numbers stn ON stn.id = o.shipment_id
                 WHERE stn.tracking_number_raw = $1 LIMIT 1`,
                [shippingTracking]
            );
            if (existingOrder.rows.length > 0) {
                skippedExisting++;
                continue;
            }

            const packerKey = packerName ? String(packerName).trim().toLowerCase() : '';
            const techKey = techName ? String(techName).trim().toLowerCase() : '';
            const packedById = packerKey ? (packerNameMap[packerKey] || null) : null;
            const testedById = techKey ? (techNameMap[techKey] || null) : null;
            const parsedShipByDate = rawShipByDate ? new Date(rawShipByDate) : null;
            const shipByDate = parsedShipByDate && !isNaN(parsedShipByDate.getTime()) ? parsedShipByDate : null;

            // packer_id and tester_id were removed from orders; assignments go to work_assignments.
            const insertedOrder = await client.query(
                `INSERT INTO orders (
                    order_id, product_title, quantity, condition,
                    sku, notes, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id`,
                [
                    orderId, productTitle, quantity, condition,
                    sku, notes, 'shipped',
                ]
            );

            const newOrderId = insertedOrder.rows[0]?.id;
            if (newOrderId) {
                if (testedById) {
                    await client.query(
                        `INSERT INTO work_assignments
                             (entity_type, entity_id, work_type, assigned_tech_id, status, priority, deadline_at, notes, completed_at)
                         VALUES ('ORDER', $1, 'TEST', $2, 'DONE', 100, $3, 'Imported from Google Sheets sync', NOW())
                         ON CONFLICT DO NOTHING`,
                        [newOrderId, testedById, shipByDate]
                    );
                } else {
                    // No tech assigned — create canonical OPEN deadline row so the deadline is preserved.
                    await client.query(
                        `INSERT INTO work_assignments
                             (entity_type, entity_id, work_type, assigned_tech_id, status, priority, deadline_at, notes, assigned_at, created_at, updated_at)
                         VALUES ('ORDER', $1, 'TEST', NULL, 'OPEN', 100, $2, 'Canonical deadline row from sync-sheets import', NOW(), NOW(), NOW())
                         ON CONFLICT DO NOTHING`,
                        [newOrderId, shipByDate]
                    );
                }
                if (packedById) {
                    await client.query(
                        `INSERT INTO work_assignments
                             (entity_type, entity_id, work_type, assigned_packer_id, status, priority, deadline_at, notes, completed_at)
                         VALUES ('ORDER', $1, 'PACK', $2, 'DONE', 100, $3, 'Imported from Google Sheets sync', NOW())
                         ON CONFLICT DO NOTHING`,
                        [newOrderId, packedById, shipByDate]
                    );
                }
            }

            inserted++;
        }

        return {
            sheet: sheetName,
            table: 'orders',
            status: 'synced',
            inserted,
            skippedExisting,
            skippedMissingTracking,
        };
    } catch (error: any) {
        console.error('Error syncing shipped sheet:', error);
        return {
            sheet: sheetName,
            table: 'orders',
            status: 'error',
            error: error.message || String(error),
        };
    }
}

async function syncTechSheets(params: {
    client: any;
    sheets: any;
    spreadsheetId: string;
    existingSheetNames: string[];
}): Promise<SyncResult[]> {
    const { client, sheets, spreadsheetId, existingSheetNames } = params;
    const techSheets = [
        { name: 'tech_1', testedBy: 1 },
        { name: 'tech_2', testedBy: 2 },
        { name: 'tech_3', testedBy: 3 },
    ];

    const results: SyncResult[] = [];

    for (const techSheet of techSheets) {
        const sheetName = existingSheetNames.find(s => s.toLowerCase() === techSheet.name);
        if (!sheetName) {
            results.push({
                sheet: techSheet.name,
                table: 'tech_serial_numbers',
                status: 'missing',
            });
            continue;
        }

        try {
            await ensureOrdersExceptionsTable(client);
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${sheetName}!A2:D`,
            });

            const rows = response.data.values || [];
            let inserted = 0;
            let skippedExisting = 0;
            let skippedMissingTracking = 0;
            let exceptionsLogged = 0;
            const orderMatchCache = new Map<string, boolean>();
            const fnskuMatchCache = new Map<string, boolean>();

            for (const row of rows) {
                const rawTestDateTime = String(row[0] || '').trim(); // A
                const shippingTracking = String(row[2] || '').trim(); // C
                const serialNumber = String(row[3] || '').trim(); // D

                if (!shippingTracking || !rawTestDateTime) {
                    skippedMissingTracking++;
                    continue;
                }

                const parsedTestDateTime = parseSheetDateTime(rawTestDateTime);
                if (!parsedTestDateTime) {
                    skippedMissingTracking++;
                    continue;
                }

                const testDateTime = normalizePSTTimestamp(parsedTestDateTime, { fallbackToNow: true })!;

                const cacheKey = getTrackingLast8(shippingTracking) || shippingTracking.toUpperCase();
                const hasMatchingOrder = orderMatchCache.has(cacheKey)
                    ? !!orderMatchCache.get(cacheKey)
                    : await hasOrderByTracking(client, shippingTracking);
                if (!orderMatchCache.has(cacheKey)) {
                    orderMatchCache.set(cacheKey, hasMatchingOrder);
                }
                if (!hasMatchingOrder) {
                    const isFbaLikeTracking = FBA_LIKE_RE.test(shippingTracking);
                    if (isFbaLikeTracking) {
                        const fnskuKey = shippingTracking.trim().toUpperCase();
                        const fnskuExists = fnskuMatchCache.has(fnskuKey)
                            ? !!fnskuMatchCache.get(fnskuKey)
                            : await hasFbaFnsku(client, shippingTracking);
                        if (!fnskuMatchCache.has(fnskuKey)) {
                            fnskuMatchCache.set(fnskuKey, fnskuExists);
                        }
                        if (!fnskuExists) {
                            await upsertOpenOrdersException({
                                client,
                                shippingTrackingNumber: shippingTracking,
                                sourceStation: 'tech',
                                staffId: techSheet.testedBy,
                            });
                            exceptionsLogged++;
                        }
                    } else {
                        await upsertOpenOrdersException({
                            client,
                            shippingTrackingNumber: shippingTracking,
                            sourceStation: 'tech',
                            staffId: techSheet.testedBy,
                        });
                        exceptionsLogged++;
                    }
                }

                const existingByTestDateTime = await client.query(
                    `SELECT id FROM tech_serial_numbers WHERE created_at = $1::timestamp LIMIT 1`,
                    [testDateTime]
                );
                if (existingByTestDateTime.rows.length > 0) {
                    skippedExisting++;
                    continue;
                }

                const trackingKey18 = normalizeTrackingKey18(shippingTracking);
                if (!trackingKey18 || trackingKey18.length < 8) {
                    skippedMissingTracking++;
                    continue;
                }
                const { shipmentId: tsnShipmentId, scanRef: tsnScanRef } = await resolveShipmentId(shippingTracking);
                const existing = await client.query(
                    `SELECT id FROM tech_serial_numbers
                     WHERE (shipment_id IS NOT NULL AND shipment_id = $1)
                        OR (shipment_id IS NULL AND scan_ref = $2)
                     LIMIT 1`,
                    [tsnShipmentId, tsnScanRef ?? shippingTracking]
                );
                if (existing.rows.length > 0) {
                    skippedExisting++;
                    continue;
                }

                await client.query(
                    `INSERT INTO tech_serial_numbers (
                        shipment_id,
                        scan_ref,
                        serial_number,
                        serial_type,
                        tested_by
                    ) VALUES ($1, $2, $3, $4, $5)`,
                    [tsnShipmentId, tsnScanRef, serialNumber, 'SERIAL', techSheet.testedBy]
                );

                inserted++;
            }

            results.push({
                sheet: sheetName,
                table: 'tech_serial_numbers',
                status: 'synced',
                inserted,
                skippedExisting,
                skippedMissingTracking,
                exceptionsLogged,
            });
        } catch (error: any) {
            console.error(`Error syncing ${techSheet.name}:`, error);
            results.push({
                sheet: sheetName,
                table: 'tech_serial_numbers',
                status: 'error',
                error: error.message || String(error),
            });
        }
    }

    return results;
}

async function syncPackerSheets(params: {
    client: any;
    sheets: any;
    spreadsheetId: string;
    existingSheetNames: string[];
}): Promise<SyncResult[]> {
    const { client, sheets, spreadsheetId, existingSheetNames } = params;
    const packerSheetNames = existingSheetNames
        .filter((name) => /^packer_/i.test(String(name || '').trim()))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    const results: SyncResult[] = [];
    if (packerSheetNames.length === 0) {
        return [{
            sheet: 'packer_*',
            table: 'packer_logs',
            status: 'missing',
        }];
    }

    for (const sheetName of packerSheetNames) {
        const normalizedSheetName = String(sheetName || '').trim().toLowerCase();
        const fallbackByName: Record<string, number> = {
            packer_1: 4,
            packer_2: 5,
            packer_3: 6,
        };

        try {
            await ensureOrdersExceptionsTable(client);

            const packedBy = fallbackByName[normalizedSheetName] ?? null;

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${sheetName}!A2:B`,
            });

            const rows = response.data.values || [];
            let inserted = 0;
            let skippedExisting = 0;
            let skippedMissingTracking = 0;
            let exceptionsLogged = 0;
            let processed = 0;
            let directLogs = 0;
            let orderLogs = 0;
            const orderMatchCache = new Map<string, boolean>();

            for (const row of rows) {
                const packDateTime = String(row[0] || '').trim() || null; // A
                const scanInput = String(row[1] || '').trim(); // B

                if (!scanInput) {
                    skippedMissingTracking++;
                    continue;
                }
                processed++;

                const isSkuColon = scanInput.includes(':');
                const isX0Like = /^X0/i.test(scanInput);
                const trackingType = isSkuColon ? 'SKU' : isX0Like ? 'FNSKU' : 'ORDERS';

                if (trackingType === 'ORDERS') {
                    const cacheKey = getTrackingLast8(scanInput) || scanInput.toUpperCase();
                    const hasMatchingOrder = orderMatchCache.has(cacheKey)
                        ? !!orderMatchCache.get(cacheKey)
                        : await hasOrderByTracking(client, scanInput);
                    if (!orderMatchCache.has(cacheKey)) {
                        orderMatchCache.set(cacheKey, hasMatchingOrder);
                    }
                    if (!hasMatchingOrder) {
                        await upsertOpenOrdersException({
                            client,
                            shippingTrackingNumber: scanInput,
                            sourceStation: 'packer',
                            staffId: packedBy,
                        });
                        exceptionsLogged++;
                        continue;
                    }
                }

                const { shipmentId: plShipmentId, scanRef: plScanRef } = await resolveShipmentId(scanInput);
                const existing = await client.query(
                    `SELECT id FROM packer_logs
                     WHERE tracking_type = $1
                       AND packed_by IS NOT DISTINCT FROM $2
                       AND (
                         (shipment_id IS NOT NULL AND shipment_id = $3)
                         OR (shipment_id IS NULL AND scan_ref = $4)
                       )
                     LIMIT 1`,
                    [trackingType, packedBy, plShipmentId, plScanRef ?? scanInput]
                );
                if (existing.rows.length > 0) {
                    skippedExisting++;
                    continue;
                }

                await client.query(
                    `INSERT INTO packer_logs (
                        shipment_id,
                        scan_ref,
                        tracking_type,
                        created_at,
                        packed_by
                    ) VALUES ($1, $2, $3, $4, $5)`,
                    [plShipmentId, plScanRef, trackingType, normalizePSTTimestamp(packDateTime) ?? null, packedBy]
                );

                inserted++;
                if (trackingType === 'ORDERS') {
                    orderLogs++;
                } else {
                    directLogs++;
                }
            }

            results.push({
                sheet: sheetName,
                table: 'packer_logs',
                status: 'synced',
                inserted,
                skippedExisting,
                skippedMissingTracking,
                exceptionsLogged,
                processed,
                directLogs,
                orderLogs,
            });
        } catch (error: any) {
            console.error(`Error syncing ${sheetName}:`, error);
            results.push({
                sheet: sheetName,
                table: 'packer_logs',
                status: 'error',
                error: error.message || String(error),
            });
        }
    }

    return results;
}

async function syncScanFbaInSheet(params: {
    client: any;
    sheets: any;
    spreadsheetId: string;
    existingSheetNames: string[];
}): Promise<SyncResult> {
    const { client, sheets, spreadsheetId, existingSheetNames } = params;
    const sheetName = existingSheetNames.find(s => s.toLowerCase() === 'scan fba in');

    if (!sheetName) {
        return {
            sheet: 'scan fba in',
            table: 'fba_fnskus',
            status: 'missing',
        };
    }

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!B2:E`,
        });
        const rows = response.data.values || [];

        await client.query('BEGIN');
        try {
            await client.query(`
                CREATE TABLE IF NOT EXISTS fba_fnskus (
                    fnsku TEXT PRIMARY KEY,
                    product_title TEXT,
                    asin TEXT,
                    sku TEXT,
                    is_active BOOLEAN NOT NULL DEFAULT TRUE,
                    last_seen_at TIMESTAMPTZ,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_fba_fnskus_fnsku_normalized
                ON fba_fnskus (UPPER(TRIM(COALESCE(fnsku, ''))))
            `);
            await client.query(`UPDATE fba_fnskus SET is_active = FALSE, updated_at = NOW()`);

            let inserted = 0;
            const seenFnsku = new Set<string>();
            for (const row of rows) {
                const productTitle = String(row[0] || '').trim() || null; // B
                const asin = String(row[1] || '').trim() || null; // C
                const sku = String(row[2] || '').trim() || null; // D
                const fnskuRaw = String(row[3] || '').trim(); // E
                const fnsku = fnskuRaw ? fnskuRaw.toUpperCase() : null;

                // GAS X0 lookup is based on Scan FBA In column E; rows without FNSKU are not useful for matching.
                if (!fnsku) continue;
                if (seenFnsku.has(fnsku)) continue;
                seenFnsku.add(fnsku);

                await client.query(
                    `INSERT INTO fba_fnskus (fnsku, product_title, asin, sku, is_active, last_seen_at, updated_at)
                     VALUES ($1, $2, $3, $4, TRUE, NOW(), NOW())
                     ON CONFLICT (fnsku) DO UPDATE
                     SET product_title = EXCLUDED.product_title,
                         asin = EXCLUDED.asin,
                         sku = EXCLUDED.sku,
                         is_active = TRUE,
                         last_seen_at = NOW(),
                         updated_at = NOW()`,
                    [fnsku, productTitle, asin, sku]
                );
                inserted++;
            }

            await client.query('COMMIT');

            return {
                sheet: sheetName,
                table: 'fba_fnskus',
                status: 'synced',
                inserted,
            };
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
    } catch (error: any) {
        console.error('Error syncing Scan FBA In sheet:', error);
        return {
            sheet: sheetName,
            table: 'fba_fnskus',
            status: 'error',
            error: error.message || String(error),
        };
    }
}
