import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';
import { db } from '@/lib/drizzle/db';
import { orders as ordersTable } from '@/lib/drizzle/schema';

// SHIPPED_GID syncs to orders table in Neon DB
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

        // Find shipped sheet name by GID
        const destSpreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
        const destSheets = destSpreadsheet.data.sheets || [];
        const shippedSheetName = destSheets.find(s => s.properties?.sheetId === SHIPPED_GID)?.properties?.title || 'shipped';

        // Prepare the values for Shipped Google Sheet
        // Columns: A=pack_date_time, B=order_id, C=product_title, D=quantity, E=condition, F=tracking, G=serial, H=packed_by, I=tested_by, J=sku
        const shippedRowsToAppend = data.map((item: any) => [
            '',                      // A - pack_date_time (empty initially, filled when packed)
            item.orderNumber || '',  // B - order_id
            item.itemTitle || '',    // C - product_title
            item.quantity || '',     // D - quantity
            item.condition || '',    // E - condition
            item.tracking || '',     // F - shipping_tracking_number
            '',                      // G - serial_number (filled by tech)
            '',                      // H - packed_by (filled by packer)
            '',                      // I - tested_by (filled by tech)
            item.usavSku || ''       // J - sku
        ]);

        // Prepare data for Neon DB - insert into orders table (from shipped sheet data)
        const ordersToInsert = data.map((item: any) => {
            const parsedShipByDate = item.shipByDate ? new Date(item.shipByDate) : null;
            const shipByDate = parsedShipByDate && !isNaN(parsedShipByDate.getTime()) ? parsedShipByDate : null;
            return {
            orderId: item.orderNumber || '',
            productTitle: item.itemTitle || '',
            sku: item.usavSku || '',
            condition: item.condition || '',
            shippingTrackingNumber: item.tracking || '',
            shipByDate,
            notes: item.note || '',
            status: 'unassigned',
            statusHistory: [],
            isShipped: false, // New orders are not shipped yet
        };
        });

        // Append to Shipped sheet and insert into orders table in DB
        const appendShipped = sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${shippedSheetName}!A:J`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: shippedRowsToAppend,
            },
        });

        const dbInsertOrders = db.insert(ordersTable).values(ordersToInsert);

        // Append to shipped sheet (not orders sheet) and orders DB table
        await Promise.all([appendShipped, dbInsertOrders]);

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
