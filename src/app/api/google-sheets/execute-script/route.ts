import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { orders, packerLogs } from '@/lib/drizzle/schema';
import { eq, inArray } from 'drizzle-orm';
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

const DEFAULT_SPREADSHEET_ID = '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';
const FBA_LIKE_RE = /^(X00|X0|B0|FBA)/i;

export async function POST(req: NextRequest) {
    try {
        const { scriptName } = await req.json();

        switch (scriptName) {
            case 'checkShippedOrders':
                return await executeCheckShippedOrders();
            case 'updateNonshippedOrders':
                return await executeUpdateNonshippedOrders();
            case 'syncTechSerialNumbers':
                return await executeSyncTechSerialNumbers();
            case 'syncPackerLogs':
                return await executeSyncPackerLogs();
            default:
                return NextResponse.json({ success: false, error: 'Unknown script name' }, { status: 400 });
        }
    } catch (error: any) {
        console.error('Script execution error:', error);
        return NextResponse.json({ success: false, error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}

async function executeCheckShippedOrders() {
    // Get all packer logs with tracking numbers
    const packerLogsData = await db.select().from(packerLogs);
    
    // Get all orders that are not yet marked as shipped
    const ordersData = await db.select().from(orders).where(eq(orders.isShipped, false));
    
    // Create a set of tracking numbers from packer logs for faster lookup
    const packerTrackingSet = new Set(
        packerLogsData
            .map(log => String(log.shippingTrackingNumber || '').trim())
            .filter(tracking => tracking !== '')
    );
    
    // Find orders that have matching tracking numbers in packer logs
    const ordersToUpdate: number[] = [];
    for (const order of ordersData) {
        const orderTracking = String(order.shippingTrackingNumber || '').trim();
        if (orderTracking && packerTrackingSet.has(orderTracking)) {
            ordersToUpdate.push(order.id);
        }
    }
    
    // Update orders to mark as shipped
    if (ordersToUpdate.length > 0) {
        await db
            .update(orders)
            .set({ isShipped: true })
            .where(inArray(orders.id, ordersToUpdate));
    }
    
    return NextResponse.json({ 
        success: true, 
        message: `Checked ${ordersData.length} orders. Updated ${ordersToUpdate.length} orders to shipped status.` 
    });
}

async function executeUpdateNonshippedOrders() {
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;

    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetInfos = spreadsheet.data.sheets || [];
    const sheetNames = sheetInfos.map(s => s.properties?.title || '');
    const ordersSheetName = sheetNames.find(s => s.toLowerCase() === 'orders');
    const shippedSheetName = sheetNames.find(s => s.toLowerCase() === 'shipped');

    if (!ordersSheetName) {
        return NextResponse.json({ success: false, error: 'Orders sheet not found' }, { status: 404 });
    }
    if (!shippedSheetName) {
        return NextResponse.json({ success: false, error: 'Shipped sheet not found' }, { status: 404 });
    }

    const getLastEightDigits = (value: any) => {
        const digits = String(value || '').replace(/\D/g, '');
        return digits.slice(-8);
    };

    // Step 1: GAS-equivalent transferExistingOrdersToRestock:
    // Delete Orders rows where Shipped has timestamp + matching tracking/order id.
    let deletedFromOrdersSheet = 0;
    const ordersSheetId = sheetInfos.find(s => s.properties?.title === ordersSheetName)?.properties?.sheetId;
    if (ordersSheetId !== undefined) {
        const [shippedResponse, ordersIdsResponse, ordersTrackingResponse] = await Promise.all([
            sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${shippedSheetName}!A2:F`,
            }),
            sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${ordersSheetName}!B2:B`,
            }),
            sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${ordersSheetName}!G2:G`,
            }),
        ]);

        const shippedRows = shippedResponse.data.values || [];
        const ordersIdRows = ordersIdsResponse.data.values || [];
        const ordersTrackingRows = ordersTrackingResponse.data.values || [];

        const shippedTrackings = new Set<string>();
        const shippedOrderIds = new Set<string>();

        for (const row of shippedRows) {
            const timestamp = String(row[0] || '').trim(); // A
            const orderId = String(row[1] || '').trim(); // B
            const tracking = String(row[5] || '').trim(); // F
            if (!timestamp) continue;
            if (tracking) shippedTrackings.add(getLastEightDigits(tracking));
            if (orderId) shippedOrderIds.add(orderId);
        }

        const rowsToDelete = new Set<number>();

        for (let i = 0; i < ordersTrackingRows.length; i++) {
            const tracking = String(ordersTrackingRows[i]?.[0] || '').trim();
            if (!tracking) continue;
            if (shippedTrackings.has(getLastEightDigits(tracking))) {
                rowsToDelete.add(i + 2); // A1 header offset
            }
        }

        for (let i = 0; i < ordersIdRows.length; i++) {
            const orderId = String(ordersIdRows[i]?.[0] || '').trim();
            if (!orderId) continue;
            if (shippedOrderIds.has(orderId)) {
                rowsToDelete.add(i + 2); // A1 header offset
            }
        }

        const sortedRowsToDelete = Array.from(rowsToDelete).sort((a, b) => b - a);
        if (sortedRowsToDelete.length > 0) {
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                requestBody: {
                    requests: sortedRowsToDelete.map((rowNumber) => ({
                        deleteDimension: {
                            range: {
                                sheetId: ordersSheetId,
                                dimension: 'ROWS',
                                startIndex: rowNumber - 1, // 0-based inclusive
                                endIndex: rowNumber, // 0-based exclusive
                            },
                        },
                    })),
                },
            });
            deletedFromOrdersSheet = sortedRowsToDelete.length;
        }
    }

    // Step 2: Re-read remaining Orders G column and sync DB shipped state.
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${ordersSheetName}!G2:G`,
    });

    const rows = response.data.values || [];
    const trackingSet = new Set<string>();
    for (const row of rows) {
        const tracking = String(row[0] || '').trim();
        if (tracking) trackingSet.add(tracking);
    }

    const trackingList = Array.from(trackingSet);

    // Default: mark all orders shipped
    await db.update(orders).set({ isShipped: true });

    if (trackingList.length === 0) {
        return NextResponse.json({
            success: true,
            message: 'No tracking numbers found in Orders sheet column G. Marked all orders as shipped.',
        });
    }

    let updatedCount = 0;
    const batchSize = 1000;
    for (let i = 0; i < trackingList.length; i += batchSize) {
        const batch = trackingList.slice(i, i + batchSize);
        const matchingOrders = await db
            .select({ id: orders.id })
            .from(orders)
            .where(inArray(orders.shippingTrackingNumber, batch));

        const idsToUpdate = matchingOrders.map(o => o.id);
        if (idsToUpdate.length > 0) {
            await db
                .update(orders)
                .set({ isShipped: false })
                .where(inArray(orders.id, idsToUpdate));
            updatedCount += idsToUpdate.length;
        }
    }

    return NextResponse.json({
        success: true,
        message: `Processed Orders sheet cleanup (deleted ${deletedFromOrdersSheet} row(s)), then marked all DB orders shipped and set ${updatedCount} matching Orders sheet column G tracking row(s) to non-shipped.`,
    });
}

async function executeSyncTechSerialNumbers() {
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;

    const techSheets = [
        { name: 'tech_1', testedBy: 1 },
        { name: 'tech_2', testedBy: 2 },
        { name: 'tech_3', testedBy: 3 },
    ];

    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheetNames = spreadsheet.data.sheets?.map(s => s.properties?.title || '') || [];

    const client = await pool.connect();
    const summary: Array<{ sheet: string; inserted: number; skippedExisting: number; skippedMissingTracking: number; exceptionsLogged: number }> = [];
    let totalInserted = 0;
    let totalSkippedExisting = 0;
    let totalSkippedMissingTracking = 0;
    let totalExceptionsLogged = 0;

    try {
        await client.query('BEGIN');
        await ensureOrdersExceptionsTable(client);

        for (const techSheet of techSheets) {
            const sheetName = existingSheetNames.find(name => name.toLowerCase() === techSheet.name);
            if (!sheetName) {
                summary.push({ sheet: techSheet.name, inserted: 0, skippedExisting: 0, skippedMissingTracking: 0, exceptionsLogged: 0 });
                continue;
            }

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${sheetName}!A2:D`,
            });

            const rows = response.data.values || [];
            let insertedForSheet = 0;
            let skippedExistingForSheet = 0;
            let skippedMissingTrackingForSheet = 0;
            let exceptionsLoggedForSheet = 0;
            const orderMatchCache = new Map<string, boolean>();
            const fnskuMatchCache = new Map<string, boolean>();

            for (const row of rows) {
                const rawTestDateTime = String(row[0] || '').trim(); // A
                const shippingTrackingNumber = String(row[2] || '').trim(); // C
                const serialNumber = String(row[3] || '').trim(); // D

                if (!shippingTrackingNumber || !rawTestDateTime) {
                    skippedMissingTrackingForSheet++;
                    continue;
                }

                const parsedTestDateTime = parseSheetDateTime(rawTestDateTime);
                if (!parsedTestDateTime) {
                    skippedMissingTrackingForSheet++;
                    continue;
                }

                const cacheKey = getTrackingLast8(shippingTrackingNumber) || shippingTrackingNumber.toUpperCase();
                const hasMatchingOrder = orderMatchCache.has(cacheKey)
                    ? !!orderMatchCache.get(cacheKey)
                    : await hasOrderByTracking(client, shippingTrackingNumber);
                if (!orderMatchCache.has(cacheKey)) {
                    orderMatchCache.set(cacheKey, hasMatchingOrder);
                }
                if (!hasMatchingOrder) {
                    const isFbaLikeTracking = FBA_LIKE_RE.test(shippingTrackingNumber);
                    if (isFbaLikeTracking) {
                        const fnskuKey = shippingTrackingNumber.trim().toUpperCase();
                        const fnskuExists = fnskuMatchCache.has(fnskuKey)
                            ? !!fnskuMatchCache.get(fnskuKey)
                            : await hasFbaFnsku(client, shippingTrackingNumber);
                        if (!fnskuMatchCache.has(fnskuKey)) {
                            fnskuMatchCache.set(fnskuKey, fnskuExists);
                        }
                        if (!fnskuExists) {
                            await upsertOpenOrdersException({
                                client,
                                shippingTrackingNumber,
                                sourceStation: 'tech',
                                staffId: techSheet.testedBy,
                            });
                            exceptionsLoggedForSheet++;
                        }
                    } else {
                        await upsertOpenOrdersException({
                            client,
                            shippingTrackingNumber,
                            sourceStation: 'tech',
                            staffId: techSheet.testedBy,
                        });
                        exceptionsLoggedForSheet++;
                    }
                }

                const testDateTime = parsedTestDateTime.toISOString();
                const existingByTestDateTime = await client.query(
                    `SELECT id FROM tech_serial_numbers WHERE test_date_time = $1::timestamp LIMIT 1`,
                    [testDateTime]
                );
                if (existingByTestDateTime.rows.length > 0) {
                    skippedExistingForSheet++;
                    continue;
                }
                const trackingKey18 = normalizeTrackingKey18(shippingTrackingNumber);
                if (!trackingKey18 || trackingKey18.length < 8) {
                    skippedMissingTrackingForSheet++;
                    continue;
                }
                const existingTrackingResult = await client.query(
                    `SELECT id
                     FROM tech_serial_numbers
                     WHERE RIGHT(regexp_replace(UPPER(COALESCE(shipping_tracking_number, '')), '[^A-Z0-9]', '', 'g'), 18) = $1
                     LIMIT 1`,
                    [trackingKey18]
                );
                if (existingTrackingResult.rows.length > 0) {
                    skippedExistingForSheet++;
                    continue;
                }

                await client.query(
                    `INSERT INTO tech_serial_numbers (
                        shipping_tracking_number,
                        serial_number,
                        serial_type,
                        test_date_time,
                        tested_by
                    ) VALUES ($1, $2, 'SERIAL', $3, $4)`,
                    [shippingTrackingNumber, serialNumber, testDateTime, techSheet.testedBy]
                );

                insertedForSheet++;
            }

            totalInserted += insertedForSheet;
            totalSkippedExisting += skippedExistingForSheet;
            totalSkippedMissingTracking += skippedMissingTrackingForSheet;
            totalExceptionsLogged += exceptionsLoggedForSheet;
            summary.push({
                sheet: sheetName,
                inserted: insertedForSheet,
                skippedExisting: skippedExistingForSheet,
                skippedMissingTracking: skippedMissingTrackingForSheet,
                exceptionsLogged: exceptionsLoggedForSheet
            });
        }

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }

    return NextResponse.json({
        success: true,
        message: `Synced technician sheets to tech_serial_numbers. Inserted ${totalInserted} row(s), skipped ${totalSkippedExisting} existing tracking row(s), skipped ${totalSkippedMissingTracking} row(s) missing tracking, logged ${totalExceptionsLogged} row(s) to orders_exceptions.`,
        details: summary,
    });
}

async function executeSyncPackerLogs() {
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;

    const packerSheets = [
        { name: 'packer_1', packedBy: 4 },
        { name: 'packer_2', packedBy: 5 },
    ];

    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const existingSheetNames = spreadsheet.data.sheets?.map(s => s.properties?.title || '') || [];

    const client = await pool.connect();
    const summary: Array<{ sheet: string; inserted: number; skippedExisting: number; skippedMissingTracking: number; exceptionsLogged: number }> = [];
    let totalInserted = 0;
    let totalSkippedExisting = 0;
    let totalSkippedMissingTracking = 0;
    let totalExceptionsLogged = 0;

    try {
        await client.query('BEGIN');
        await ensureOrdersExceptionsTable(client);

        for (const packerSheet of packerSheets) {
            const sheetName = existingSheetNames.find(name => name.toLowerCase() === packerSheet.name);
            if (!sheetName) {
                summary.push({ sheet: packerSheet.name, inserted: 0, skippedExisting: 0, skippedMissingTracking: 0, exceptionsLogged: 0 });
                continue;
            }

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${sheetName}!A2:B`,
            });

            const rows = response.data.values || [];
            let insertedForSheet = 0;
            let skippedExistingForSheet = 0;
            let skippedMissingTrackingForSheet = 0;
            let exceptionsLoggedForSheet = 0;
            const orderMatchCache = new Map<string, boolean>();

            for (const row of rows) {
                const packDateTime = String(row[0] || '').trim(); // A
                const shippingTrackingNumber = String(row[1] || '').trim(); // B

                if (!shippingTrackingNumber) {
                    skippedMissingTrackingForSheet++;
                    continue;
                }

                const cacheKey = getTrackingLast8(shippingTrackingNumber) || shippingTrackingNumber.toUpperCase();
                const hasMatchingOrder = orderMatchCache.has(cacheKey)
                    ? !!orderMatchCache.get(cacheKey)
                    : await hasOrderByTracking(client, shippingTrackingNumber);
                if (!orderMatchCache.has(cacheKey)) {
                    orderMatchCache.set(cacheKey, hasMatchingOrder);
                }
                if (!hasMatchingOrder) {
                    await upsertOpenOrdersException({
                        client,
                        shippingTrackingNumber,
                        sourceStation: 'packer',
                        staffId: packerSheet.packedBy,
                    });
                    exceptionsLoggedForSheet++;
                }

                const existingTrackingResult = await client.query(
                    `SELECT id FROM packer_logs WHERE shipping_tracking_number = $1 LIMIT 1`,
                    [shippingTrackingNumber]
                );
                if (existingTrackingResult.rows.length > 0) {
                    skippedExistingForSheet++;
                    continue;
                }

                await client.query(
                    `INSERT INTO packer_logs (
                        shipping_tracking_number,
                        tracking_type,
                        pack_date_time,
                        packed_by
                    ) VALUES ($1, $2, $3, $4)`,
                    [shippingTrackingNumber, 'ORDERS', packDateTime || null, packerSheet.packedBy]
                );

                insertedForSheet++;
            }

            totalInserted += insertedForSheet;
            totalSkippedExisting += skippedExistingForSheet;
            totalSkippedMissingTracking += skippedMissingTrackingForSheet;
            totalExceptionsLogged += exceptionsLoggedForSheet;
            summary.push({
                sheet: sheetName,
                inserted: insertedForSheet,
                skippedExisting: skippedExistingForSheet,
                skippedMissingTracking: skippedMissingTrackingForSheet,
                exceptionsLogged: exceptionsLoggedForSheet
            });
        }

        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }

    return NextResponse.json({
        success: true,
        message: `Synced packer sheets to packer_logs. Inserted ${totalInserted} row(s), skipped ${totalSkippedExisting} existing tracking row(s), skipped ${totalSkippedMissingTracking} row(s) missing tracking, logged ${totalExceptionsLogged} row(s) to orders_exceptions.`,
        details: summary,
    });
}
