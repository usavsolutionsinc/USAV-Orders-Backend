import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';
import pool from '@/lib/db';

export const maxDuration = 60;

const DEFAULT_SPREADSHEET_ID = '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';

type SyncResult = {
    sheet: string;
    table: string;
    status: 'synced' | 'error' | 'missing';
    inserted?: number;
    skippedExisting?: number;
    skippedMissingTracking?: number;
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

            const receivingResult = await syncReceivingSheet({
                client,
                sheets,
                spreadsheetId: targetSpreadsheetId,
                existingSheetNames,
            });
            results.push(receivingResult);

            const fbaFnskuResult = await syncScanFbaInSheet({
                client,
                sheets,
                spreadsheetId: targetSpreadsheetId,
                existingSheetNames,
            });
            results.push(fbaFnskuResult);
        } finally {
            client.release();
        }

        const hasErrors = results.some(r => r.status === 'error');

        return NextResponse.json({
            success: !hasErrors,
            message: hasErrors
                ? 'Sync completed with errors'
                : 'Synced shipped, tech, packer, receiving, and scan fba in sheets to Neon DB',
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
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${sheetName}!A2:D`,
            });

            const rows = response.data.values || [];
            let inserted = 0;
            let skippedExisting = 0;
            let skippedMissingTracking = 0;

            for (const row of rows) {
                const testDateTime = String(row[0] || '').trim() || null; // A
                const shippingTracking = String(row[2] || '').trim(); // C
                const serialNumber = String(row[3] || '').trim(); // D

                if (!shippingTracking) {
                    skippedMissingTracking++;
                    continue;
                }

                const existing = await client.query(
                    `SELECT id FROM tech_serial_numbers WHERE shipping_tracking_number = $1 LIMIT 1`,
                    [shippingTracking]
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
    const packerSheets = [
        { name: 'packer_1', packedBy: 4 },
        { name: 'packer_2', packedBy: 5 },
    ];

    const results: SyncResult[] = [];

    for (const packerSheet of packerSheets) {
        const sheetName = existingSheetNames.find(s => s.toLowerCase() === packerSheet.name);
        if (!sheetName) {
            results.push({
                sheet: packerSheet.name,
                table: 'packer_logs',
                status: 'missing',
            });
            continue;
        }

        try {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range: `${sheetName}!A2:B`,
            });

            const rows = response.data.values || [];
            let inserted = 0;
            let skippedExisting = 0;
            let skippedMissingTracking = 0;

            for (const row of rows) {
                const packDateTime = String(row[0] || '').trim() || null; // A
                const shippingTracking = String(row[1] || '').trim(); // B

                if (!shippingTracking) {
                    skippedMissingTracking++;
                    continue;
                }

                const existing = await client.query(
                    `SELECT id FROM packer_logs WHERE shipping_tracking_number = $1 LIMIT 1`,
                    [shippingTracking]
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
                    [shippingTracking, 'ORDERS', packDateTime, packerSheet.packedBy]
                );

                inserted++;
            }

            results.push({
                sheet: sheetName,
                table: 'packer_logs',
                status: 'synced',
                inserted,
                skippedExisting,
                skippedMissingTracking,
            });
        } catch (error: any) {
            console.error(`Error syncing ${packerSheet.name}:`, error);
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

async function syncReceivingSheet(params: {
    client: any;
    sheets: any;
    spreadsheetId: string;
    existingSheetNames: string[];
}): Promise<SyncResult> {
    const { client, sheets, spreadsheetId, existingSheetNames } = params;
    const sheetName = existingSheetNames.find(s => s.toLowerCase() === 'receiving');

    if (!sheetName) {
        return {
            sheet: 'receiving',
            table: 'receiving',
            status: 'missing',
        };
    }

    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A2:C`,
        });

        const rows = response.data.values || [];
        let inserted = 0;
        let skippedExisting = 0;
        let skippedMissingTracking = 0;

        const dateColumn = await resolveReceivingDateColumn(client);

        for (const row of rows) {
            const receivingDateTime = String(row[0] || '').trim() || null; // A
            const receivingTracking = String(row[1] || '').trim(); // B
            const carrier = String(row[2] || '').trim() || null; // C

            if (!receivingTracking) {
                skippedMissingTracking++;
                continue;
            }

            const existing = await client.query(
                `SELECT id FROM receiving WHERE receiving_tracking_number = $1 LIMIT 1`,
                [receivingTracking]
            );
            if (existing.rows.length > 0) {
                skippedExisting++;
                continue;
            }

            await client.query(
                `INSERT INTO receiving (${dateColumn}, receiving_tracking_number, carrier)
                 VALUES ($1, $2, $3)`,
                [receivingDateTime, receivingTracking, carrier]
            );

            inserted++;
        }

        return {
            sheet: sheetName,
            table: 'receiving',
            status: 'synced',
            inserted,
            skippedExisting,
            skippedMissingTracking,
        };
    } catch (error: any) {
        console.error('Error syncing receiving sheet:', error);
        return {
            sheet: sheetName,
            table: 'receiving',
            status: 'error',
            error: error.message || String(error),
        };
    }
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
            await client.query('TRUNCATE TABLE fba_fnskus');

            let inserted = 0;
            for (const row of rows) {
                const productTitle = String(row[0] || '').trim() || null; // B
                const asin = String(row[1] || '').trim() || null; // C
                const sku = String(row[2] || '').trim() || null; // D
                const fnsku = String(row[3] || '').trim() || null; // E

                if (!productTitle && !asin && !sku && !fnsku) continue;

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

async function resolveReceivingDateColumn(client: any): Promise<string> {
    const result = await client.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'receiving'
           AND column_name IN ('receiving_date_time', 'date_time')`
    );

    const columnNames = result.rows.map((row: any) => row.column_name);
    if (columnNames.includes('receiving_date_time')) return 'receiving_date_time';
    return 'date_time';
}
