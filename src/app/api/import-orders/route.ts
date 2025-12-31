import { NextResponse } from 'next/server';
import { google } from 'googleapis';

interface OrderRow {
    shipByDate: string;
    orderNumber: string;
    itemTitle: string;
    quantity: string;
    sku: string;
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
 * Write data to Google Sheets "Orders" sheet
 * Maps data to col_1 through col_10 format
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

        // Get existing data to find next row
        let nextRow = 1;
        let hasHeaders = false;
        try {
            const existingData = await sheetsClient.spreadsheets.values.get({
                spreadsheetId,
                range: `${sheetName}!A:A`,
            });
            if (existingData.data.values && existingData.data.values.length > 0) {
                nextRow = existingData.data.values.length + 1;
                hasHeaders = true; // Assume headers exist if there's data
            }
        } catch (e) {
            // If no data exists, start at row 1
            nextRow = 1;
            hasHeaders = false;
        }

        // Prepare data rows for Google Sheet
        // Column mapping: A=Ship by date, B=Order Number, C=Item Title, D=Quantity, E=SKU, F=Condition, G=Tracking Number, H=empty, I=empty, J=Note
        const rows = data.map((row) => [
            row.shipByDate || '',      // A: Ship by date
            row.orderNumber || '',     // B: Order Number
            row.itemTitle || '',       // C: Item Title
            row.quantity || '',        // D: Quantity
            row.sku || '',             // E: SKU
            row.condition || '',       // F: Condition
            row.trackingNumber || '',  // G: Tracking Number
            '',                        // H: (empty)
            '',                        // I: (empty)
            row.note || '',            // J: Note
        ]);

        // Write data to columns A through J
        if (rows.length > 0) {
            await sheetsClient.spreadsheets.values.update({
                spreadsheetId,
                range: `${sheetName}!A${nextRow}:J${nextRow + rows.length - 1}`,
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

        // Always write to "Orders" sheet
        const targetSheetName = 'Orders';

        console.log(`[IMPORT] Writing to sheet: ${targetSheetName}`);

        // Write data to Google Sheet
        await writeToGoogleSheet(sheetsClient, spreadsheetId, targetSheetName, data);

        console.log(`[IMPORT] Wrote ${data.length} rows to ${targetSheetName}`);

        return NextResponse.json({
            success: true,
            message: `Successfully imported ${data.length} rows to ${targetSheetName}`,
            sheetName: targetSheetName,
            rowsImported: data.length,
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

