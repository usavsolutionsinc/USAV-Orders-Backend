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

        // Prepare data for Neon DB - only columns A-J from sheet
        const ordersToInsert = data.map((item: any) => ({
            shipByDate: item.shipByDate || '',
            orderId: item.orderNumber || '',
            productTitle: item.itemTitle || '',
            quantity: item.quantity || '',
            sku: item.usavSku || '',
            condition: item.condition || '',
            shippingTrackingNumber: item.tracking || '',
            daysLate: '',
            outOfStock: '',
            notes: item.note || '',
            // assignedTo, status, urgent, skippedBy rely on DB defaults
        }));

        const shippedToInsert = data.map((item: any) => ({
            dateTime: '',                                    // Will be set when packer confirms shipment
            orderId: item.orderNumber || '',
            productTitle: item.itemTitle || '',
            condition: item.condition || '',
            shippingTrackingNumber: item.tracking || '',
            serialNumber: '',                                // Will be filled by tech scan
            boxedBy: '',                                     // Will be filled by packer
            testedBy: '',                                    // Will be filled by tech scan
            sku: item.usavSku || '',
            status: 'pending',
            statusHistory: '[]',
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

        // Automatically run calculateLateOrders after import
        try {
            const baseUrl = request.url.split('/api/')[0];
            await fetch(`${baseUrl}/api/google-sheets/execute-script`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ scriptName: 'calculateLateOrders' })
            });
        } catch (err) {
            console.error('Failed to auto-execute calculateLateOrders:', err);
            // Don't fail the import if this fails
        }

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
