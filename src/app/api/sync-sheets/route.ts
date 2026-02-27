import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';
import pool from '@/lib/db';
import { normalizeTrackingKey18 } from '@/lib/tracking-format';
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
        const sheets = google.sheets({ version: 'v4', auth });

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
            timestamp: new Date().toISOString(),
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
                'SELECT id FROM orders WHERE shipping_tracking_number = $1 LIMIT 1',
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

            await client.query(
                `INSERT INTO orders (
                    order_id, product_title, quantity, condition,
                    shipping_tracking_number, packer_id, tester_id,
                    ship_by_date, sku, notes, is_shipped
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                [
                    orderId, productTitle, quantity, condition,
                    shippingTracking, packedById, testedById,
                    shipByDate, sku, notes, true,
                ]
            );

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

                const testDateTime = parsedTestDateTime.toISOString();

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
                    `SELECT id FROM tech_serial_numbers WHERE test_date_time = $1::timestamp LIMIT 1`,
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
                const existing = await client.query(
                    `SELECT id
                     FROM tech_serial_numbers
                     WHERE RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
                     LIMIT 1`,
                    [trackingKey18]
                );
                if (existing.rows.length > 0) {
                    skippedExisting++;
                    continue;
                }

                await client.query(
                    `INSERT INTO tech_serial_numbers (
                        shipping_tracking_number,
                        serial_number,
                        serial_type,
                        test_date_time,
                        tested_by
                    ) VALUES ($1, $2, $3, $4, $5)`,
                    [shippingTracking, serialNumber, 'SERIAL', testDateTime, techSheet.testedBy]
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

            const staffLookup = await client.query(
                `SELECT id
                 FROM staff
                 WHERE LOWER(COALESCE(source_table, '')) = $1
                 ORDER BY active DESC, id ASC
                 LIMIT 1`,
                [normalizedSheetName]
            );
            const packedBy = staffLookup.rows[0]?.id ?? fallbackByName[normalizedSheetName] ?? null;

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

                const existing = await client.query(
                    `SELECT id
                     FROM packer_logs
                     WHERE shipping_tracking_number = $1
                       AND tracking_type = $2
                       AND packed_by IS NOT DISTINCT FROM $3
                     LIMIT 1`,
                    [scanInput, trackingType, packedBy]
                );
                if (existing.rows.length > 0) {
                    skippedExisting++;
                    continue;
                }

                await client.query(
                    `INSERT INTO packer_logs (
                        shipping_tracking_number,
                        tracking_type,
                        pack_date_time,
                        packed_by
                    ) VALUES ($1, $2, $3, $4)`,
                    [scanInput, trackingType, packDateTime, packedBy]
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
                    product_title TEXT,
                    asin TEXT,
                    sku TEXT,
                    fnsku TEXT
                )
            `);
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_fba_fnskus_fnsku_normalized
                ON fba_fnskus (UPPER(TRIM(COALESCE(fnsku, ''))))
            `);
            await client.query('TRUNCATE TABLE fba_fnskus');

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
                    `INSERT INTO fba_fnskus (product_title, asin, sku, fnsku) VALUES ($1, $2, $3, $4)`,
                    [productTitle, asin, sku, fnsku]
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
