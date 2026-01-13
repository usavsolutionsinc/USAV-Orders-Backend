import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';
import { db } from '@/lib/drizzle/db';
import { orders as ordersTable, shipped as shippedTable } from '@/lib/drizzle/schema';

const ORDERS_GID = 719315456;
const SHIPPED_GID = 316829503;

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { data } = body;

        if (!data || !Array.isArray(data)) {
            return NextResponse.json({ error: 'Invalid data format' }, { status: 400 });
        }

        const auth = getGoogleAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';

        // Find destination sheet names by GID
        const destSpreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
        const destSheets = destSpreadsheet.data.sheets || [];
        const ordersSheetName = destSheets.find(s => s.properties?.sheetId === ORDERS_GID)?.properties?.title || 'Orders';
        const shippedSheetName = destSheets.find(s => s.properties?.sheetId === SHIPPED_GID)?.properties?.title || 'Shipped';

        // Prepare the values for Google Sheets
        const rowsToAppend = data.map((item: any) => [
            item.shipByDate,   // A
            item.orderNumber,  // B
            item.itemTitle,    // C
            item.quantity,     // D
            item.usavSku,      // E
            item.condition,    // F
            item.tracking,     // G
            '',                // H (Empty)
            '',                // I (Empty) - Column 9
            item.note          // J
        ]);

        const shippedRowsToAppend = data.map((item: any) => [
            '',                // 1 - Date / Time (empty initially)
            item.orderNumber,  // 2 - Order ID
            item.itemTitle,    // 3 - Product Title
            item.condition,    // 4 - Sent (product condition)
            item.tracking,     // 5 - Shipping TRK #
            '',                // 6 - Serial Number
            '',                // 7 - Box
            '',                // 8 - By
            '',                // 9 - SKU
            ''                 // 10 - Status
        ]);

        // Prepare data for Neon DB - matching Google Sheets column order
        const ordersToInsert = data.map((item: any) => ({
            col_2: item.shipByDate || '',      // Column A
            col_3: item.orderNumber || '',     // Column B
            col_4: item.itemTitle || '',       // Column C
            col_5: item.quantity || '',        // Column D
            col_6: item.usavSku || '',         // Column E
            col_7: item.condition || '',       // Column F
            col_8: item.tracking || '',        // Column G
            col_9: '',                         // Column H (Empty)
            col_10: '',                        // Column I (Empty)
            col_11: item.note || '',           // Column J
        }));

        const shippedToInsert = data.map((item: any) => ({
            col_2: '',                         // Column A - Date/Time (empty initially)
            col_3: item.orderNumber || '',     // Column B - Order ID
            col_4: item.itemTitle || '',       // Column C - Product Title
            col_5: item.condition || '',       // Column D - Condition
            col_6: item.tracking || '',        // Column E - Tracking Number
        }));

        const appendOrders = sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${ordersSheetName}!A:J`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: rowsToAppend,
            },
        });

        const appendShipped = sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${shippedSheetName}!A:J`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: shippedRowsToAppend,
            },
        });

        const dbInsertOrders = db.insert(ordersTable).values(ordersToInsert);
        const dbInsertShipped = db.insert(shippedTable).values(shippedToInsert);

        await Promise.all([appendOrders, appendShipped, dbInsertOrders, dbInsertShipped]);

        return NextResponse.json({ 
            success: true, 
            message: `Successfully imported ${data.length} orders to Sheets and DB.` 
        });
    } catch (error: any) {
        console.error('Import error:', error);
        return NextResponse.json({ 
            error: 'Internal Server Error', 
            details: error.message 
        }, { status: 500 });
    }
}
