import { NextResponse } from 'next/server';
import { google } from 'googleapis';
import pool from '@/lib/db';

interface OrderRow {
    shipByDate: string;
    orderNumber: string;
    itemTitle: string;
    quantity: string;
    condition: string;
    trackingNumber: string;
    note: string;
}

/**
 * Get Google Sheets client using service account
 */
async function getGoogleSheetsClient() {
    const auth = new google.auth.JWT({
        email: process.env.GOOGLE_CLIENT_EMAIL,
        key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive',
        ],
    });

    return {
        sheets: google.sheets({ version: 'v4', auth }),
        auth: auth,
    };
}

/**
 * Parse date sheet name (e.g., "Sheet_12_31_2025" or "Sheet_1_1_2026")
 * Returns Date object for comparison
 */
function parseSheetDate(sheetName: string): Date | null {
    const match = sheetName.match(/^Sheet_(\d+)_(\d+)_(\d+)$/);
    if (!match) return null;

    const [, month, day, year] = match;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    return isNaN(date.getTime()) ? null : date;
}

/**
 * Find the highest date sheet name
 */
async function findHighestDateSheet(sheetsClient: any, spreadsheetId: string): Promise<string | null> {
    try {
        const metadata = await sheetsClient.spreadsheets.get({
            spreadsheetId,
        });

        const sheets = (metadata.data.sheets || [])
            .map((s: any) => s.properties?.title || '')
            .filter((name: string) => name.startsWith('Sheet_') && /^Sheet_\d+_\d+_\d+$/.test(name));

        if (sheets.length === 0) {
            return null;
        }

        // Sort by date (highest first)
        const sortedSheets = sheets.sort((a: string, b: string) => {
            const dateA = parseSheetDate(a);
            const dateB = parseSheetDate(b);
            if (!dateA || !dateB) return 0;
            return dateB.getTime() - dateA.getTime(); // Descending order
        });

        return sortedSheets[0]; // Return highest date sheet
    } catch (error: any) {
        console.error('Error finding highest date sheet:', error);
        return null;
    }
}

/**
 * Write data to Google Sheets
 */
async function writeToGoogleSheet(
    sheetsClient: any,
    spreadsheetId: string,
    sheetName: string,
    data: OrderRow[]
): Promise<void> {
    try {
        // Check if sheet exists, create if not
        let sheetExists = false;
        try {
            await sheetsClient.spreadsheets.values.get({
                spreadsheetId,
                range: `${sheetName}!A1`,
            });
            sheetExists = true;
        } catch (e: any) {
            if (e.code === 400) {
                // Sheet doesn't exist, create it
                await sheetsClient.spreadsheets.batchUpdate({
                    spreadsheetId,
                    requestBody: {
                        requests: [{
                            addSheet: {
                                properties: {
                                    title: sheetName,
                                },
                            },
                        }],
                    },
                });
                sheetExists = true;
            } else {
                throw e;
            }
        }

        // Prepare header row
        const headers = [
            'Ship by date',
            'Order Number',
            'Item Title',
            'Quantity',
            'Condition',
            'Tracking Number',
            'Note',
        ];

        // Get existing data to find next row
        let nextRow = 1;
        try {
            const existingData = await sheetsClient.spreadsheets.values.get({
                spreadsheetId,
                range: `${sheetName}!A:A`,
            });
            if (existingData.data.values) {
                nextRow = existingData.data.values.length + 1;
            }
        } catch (e) {
            // If no data exists, start at row 1
            nextRow = 1;
        }

        // If starting fresh, add headers
        if (nextRow === 1) {
            await sheetsClient.spreadsheets.values.update({
                spreadsheetId,
                range: `${sheetName}!A1:G1`,
                valueInputOption: 'RAW',
                requestBody: {
                    values: [headers],
                },
            });
            nextRow = 2;
        }

        // Prepare data rows
        const rows = data.map((row) => [
            row.shipByDate || '',
            row.orderNumber || '',
            row.itemTitle || '',
            row.quantity || '',
            row.condition || '',
            row.trackingNumber || '',
            row.note || '',
        ]);

        // Write data
        if (rows.length > 0) {
            await sheetsClient.spreadsheets.values.update({
                spreadsheetId,
                range: `${sheetName}!A${nextRow}:G${nextRow + rows.length - 1}`,
                valueInputOption: 'RAW',
                requestBody: {
                    values: rows,
                },
            });
        }
    } catch (error: any) {
        console.error('Error writing to Google Sheet:', error);
        throw error;
    }
}

/**
 * Sync orders sheet to database directly (10 columns only)
 */
async function syncOrdersToDatabase(sheetsClient: any, spreadsheetId: string) {
    const client = await pool.connect();
    try {
        // Get orders sheet data
        const ordersData = await getSheetDataByPosition(sheetsClient, spreadsheetId, 'Orders', 10);
        
        if (ordersData.length === 0) {
            return { success: true, message: 'No orders data to sync' };
        }

        // Sync to database with 10 columns
        for (const row of ordersData) {
            const orderId = row['col_2'] || null; // Order Number is col_2
            if (!orderId) continue;

            await client.query(`
                INSERT INTO orders (
                    col_1, col_2, col_3, col_4, col_5, col_6, col_7, col_8, col_9, col_10
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (id) DO UPDATE SET
                    col_1 = EXCLUDED.col_1,
                    col_2 = EXCLUDED.col_2,
                    col_3 = EXCLUDED.col_3,
                    col_4 = EXCLUDED.col_4,
                    col_5 = EXCLUDED.col_5,
                    col_6 = EXCLUDED.col_6,
                    col_7 = EXCLUDED.col_7,
                    col_8 = EXCLUDED.col_8,
                    col_9 = EXCLUDED.col_9,
                    col_10 = EXCLUDED.col_10
            `, [
                row['col_1'] || null,
                row['col_2'] || null,
                row['col_3'] || null,
                row['col_4'] || null,
                row['col_5'] || null,
                row['col_6'] || null,
                row['col_7'] || null,
                row['col_8'] || null,
                row['col_9'] || null,
                row['col_10'] || null,
            ]);
        }

        return { success: true, message: `Synced ${ordersData.length} orders` };
    } catch (error: any) {
        console.error('Error syncing orders to database:', error);
        throw error;
    } finally {
        client.release();
    }
}

/**
 * Get sheet data by position (helper function)
 */
async function getSheetDataByPosition(sheetsClient: any, spreadsheetId: string, sheetName: string, maxCols: number = 10): Promise<any[]> {
    try {
        const getColumnLetter = (col: number): string => {
            let result = '';
            while (col > 0) {
                col--;
                result = String.fromCharCode(65 + (col % 26)) + result;
                col = Math.floor(col / 26);
            }
            return result;
        };

        const lastCol = getColumnLetter(maxCols);
        const range = `${sheetName}!A:${lastCol}`;

        const response = await sheetsClient.spreadsheets.values.get({
            spreadsheetId,
            range,
        });

        const rows = response.data.values;
        if (!rows || rows.length < 2) {
            return [];
        }

        const data: any[] = [];
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const rowData: any = {};
            let hasData = false;

            for (let j = 0; j < maxCols; j++) {
                const colName = `col_${j + 1}`;
                const value = j < row.length ? (row[j] ? String(row[j]).trim() : '') : '';
                if (value) hasData = true;
                rowData[colName] = value || null;
            }

            if (hasData) {
                data.push(rowData);
            }
        }

        return data;
    } catch (error: any) {
        if (error.code === 404) {
            return [];
        }
        console.error(`Error reading sheet ${sheetName}:`, error.message || error);
        return [];
    }
}

export async function POST(request: Request) {
    try {
        console.log('[IMPORT] Received POST request to /api/import-orders');

        const body = await request.json();
        const { data, timestamp } = body;

        if (!Array.isArray(data) || data.length === 0) {
            return NextResponse.json(
                { success: false, error: 'No data provided' },
                { status: 400 }
            );
        }

        // Validate required environment variables
        const requiredEnvVars = {
            GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID,
            GOOGLE_CLIENT_EMAIL: process.env.GOOGLE_CLIENT_EMAIL,
            GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY,
        };

        const missing = Object.entries(requiredEnvVars)
            .filter(([_, value]) => !value)
            .map(([key]) => key);

        if (missing.length > 0) {
            return NextResponse.json(
                {
                    success: false,
                    error: `Missing required environment variables: ${missing.join(', ')}`,
                },
                { status: 500 }
            );
        }

        const spreadsheetId = process.env.GOOGLE_SHEET_ID!;
        const { sheets: sheetsClient } = await getGoogleSheetsClient();

        // Find the highest date sheet
        const highestDateSheet = await findHighestDateSheet(sheetsClient, spreadsheetId);

        if (!highestDateSheet) {
            return NextResponse.json(
                {
                    success: false,
                    error: 'No date sheet found (format: Sheet_MM_DD_YYYY)',
                },
                { status: 404 }
            );
        }

        console.log(`[IMPORT] Using sheet: ${highestDateSheet}`);

        // Write data to Google Sheet
        await writeToGoogleSheet(sheetsClient, spreadsheetId, highestDateSheet, data);

        console.log(`[IMPORT] Wrote ${data.length} rows to ${highestDateSheet}`);

        // Sync to database (orders sheet only)
        console.log('[IMPORT] Syncing orders to database...');
        const syncResult = await syncOrdersToDatabase(sheetsClient, spreadsheetId);

        console.log('[IMPORT] Import completed successfully');

        return NextResponse.json({
            success: true,
            message: `Successfully imported ${data.length} rows to ${highestDateSheet} and synced to database`,
            sheetName: highestDateSheet,
            rowsImported: data.length,
            syncResult: syncResult,
        });

    } catch (error: any) {
        console.error('[IMPORT] Error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error.message || 'Failed to import orders',
                details: error.toString(),
            },
            { status: 500 }
        );
    }
}

export async function GET(request: Request) {
    // Health check endpoint
    return NextResponse.json({
        status: 'ok',
        message: 'Import orders endpoint is available. Use POST to import data.',
        env_check: {
            has_sheet_id: !!process.env.GOOGLE_SHEET_ID,
            has_client_email: !!process.env.GOOGLE_CLIENT_EMAIL,
            has_private_key: !!process.env.GOOGLE_PRIVATE_KEY,
        },
    });
}

