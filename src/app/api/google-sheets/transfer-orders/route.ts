import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';
import { db } from '@/lib/drizzle/db';
import { orders as ordersTable, shipped as shippedTable } from '@/lib/drizzle/schema';

const SOURCE_SPREADSHEET_ID = '1b8uvgk4q7jJPjGvFM2TQs3vMES1o9MiAfbEJ7P1TW9w';
const DEST_SPREADSHEET_ID = '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';

const ORDERS_GID = 719315456;
const SHIPPED_GID = 316829503;

function getLastEightDigits(str: any) {
    if (!str) return '';
    return String(str).trim().slice(-8).toLowerCase();
}

function hasNumbers(str: any) {
    if (!str) return false;
    return /\d/.test(String(str));
}

export async function POST(req: NextRequest) {
    try {
        const auth = getGoogleAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        // Parse request body for manual sheet name
        const body = await req.json().catch(() => ({}));
        const manualSheetName = body.manualSheetName;

        // 1. Find the most relevant sheet tabs
        const [sourceSpreadsheet, destSpreadsheet] = await Promise.all([
            sheets.spreadsheets.get({ spreadsheetId: SOURCE_SPREADSHEET_ID }),
            sheets.spreadsheets.get({ spreadsheetId: DEST_SPREADSHEET_ID })
        ]);

        let targetTabName: string;

        if (manualSheetName && manualSheetName.trim() !== '') {
            // Use manual sheet name if provided
            const sourceTabs = sourceSpreadsheet.data.sheets || [];
            const manualTab = sourceTabs.find(s => s.properties?.title === manualSheetName.trim());
            
            if (!manualTab) {
                return NextResponse.json({ 
                    success: false, 
                    error: `Sheet tab "${manualSheetName}" not found in source spreadsheet` 
                }, { status: 404 });
            }
            
            targetTabName = manualSheetName.trim();
        } else {
            // Auto-detect latest sheet tab
            const sourceTabs = sourceSpreadsheet.data.sheets || [];
            const dateTabs = sourceTabs
                .map(s => s.properties?.title || '')
                .filter(title => title.startsWith('Sheet_'))
                .map(title => {
                    const parts = title.split('_');
                    if (parts.length < 4) return { title, date: new Date(0) };
                    const mm = parseInt(parts[1]);
                    const dd = parseInt(parts[2]);
                    const yyyy = parseInt(parts[3]);
                    return { title, date: new Date(yyyy, mm - 1, dd) };
                })
                .sort((a, b) => b.date.getTime() - a.date.getTime());

            if (dateTabs.length === 0) {
                return NextResponse.json({ success: false, error: 'No valid sheet tabs found in source' }, { status: 404 });
            }

            targetTabName = dateTabs[0].title;
        }

        // Find destination sheet names by GID
        const destSheets = destSpreadsheet.data.sheets || [];
        const ordersSheetName = destSheets.find(s => s.properties?.sheetId === ORDERS_GID)?.properties?.title || 'orders';
        const shippedSheetName = destSheets.find(s => s.properties?.sheetId === SHIPPED_GID)?.properties?.title || 'shipped';

        // 2. Read the Shipped sheet for existing tracking numbers to deduplicate
        const shippedTrackingResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: DEST_SPREADSHEET_ID,
            range: `${shippedSheetName}!E2:E`, // Column E is tracking in Shipped sheet
        });

        const existingTrackingInShipped = new Set(
            (shippedTrackingResponse.data.values || [])
                .flat()
                .filter(t => t && t.trim() !== '')
                .map(t => getLastEightDigits(t))
        );

        // 3. Read the source tab from Master Sheet
        const sourceDataResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SOURCE_SPREADSHEET_ID,
            range: `${targetTabName}!A1:Z`,
        });

        const sourceRows = sourceDataResponse.data.values || [];
        if (sourceRows.length < 2) {
            return NextResponse.json({ success: false, error: 'No data found in source tab' }, { status: 404 });
        }

        const headerRow = sourceRows[0];
        const colIndices = {
            shipByDate: headerRow.indexOf('Ship by date'),
            orderNumber: headerRow.indexOf('Order Number'),
            itemTitle: headerRow.indexOf('Item title'),
            quantity: headerRow.indexOf('Quantity'),
            usavSku: headerRow.indexOf('USAV SKU'),
            condition: headerRow.indexOf('Condition'),
            tracking: headerRow.indexOf('Tracking'),
            note: headerRow.indexOf('Note'),
        };

        // Validate required columns
        const missingCols = Object.entries(colIndices)
            .filter(([_, index]) => index === -1)
            .map(([name]) => name);

        if (missingCols.length > 0) {
            return NextResponse.json({ 
                success: false, 
                error: `Missing columns in source: ${missingCols.join(', ')}` 
            }, { status: 400 });
        }

        // 4. Process rows (only with tracking that contains numbers and NOT already in Shipped)
        const filteredSourceRows = sourceRows.slice(1).filter(row => {
            const tracking = row[colIndices.tracking];
            if (!tracking || tracking.trim() === '') return false;
            // Only include tracking numbers that contain at least one digit (ignore pure letter entries)
            if (!hasNumbers(tracking)) return false;
            return !existingTrackingInShipped.has(getLastEightDigits(tracking));
        });

        if (filteredSourceRows.length === 0) {
            return NextResponse.json({ 
                success: true, 
                message: 'No new rows (not in Shipped) found', 
                rowCount: 0, 
                tabName: targetTabName 
            });
        }

        // Prepare data for Google Sheets
        const processedOrdersRows = filteredSourceRows.map(row => {
            const destRow = new Array(10).fill(''); // A to J
            destRow[0] = row[colIndices.shipByDate] || '';
            destRow[1] = row[colIndices.orderNumber] || '';
            destRow[2] = row[colIndices.itemTitle] || '';
            destRow[3] = row[colIndices.quantity] || '';
            destRow[4] = row[colIndices.usavSku] || '';
            destRow[5] = row[colIndices.condition] || '';
            destRow[6] = row[colIndices.tracking] || '';
            // I (index 8) is blank
            destRow[9] = row[colIndices.note] || ''; // J (index 9)
            return destRow;
        });

        const processedShippedRows = filteredSourceRows.map(row => {
            const destRow = new Array(10).fill(''); // A to J
            destRow[0] = ''; // Column 1 empty as requested
            destRow[1] = row[colIndices.orderNumber] || '';
            destRow[2] = row[colIndices.itemTitle] || '';
            destRow[3] = row[colIndices.condition] || '';
            destRow[4] = row[colIndices.tracking] || '';
            // F-J remain empty
            return destRow;
        });

        // Prepare data for Neon DB
        const ordersToInsert = filteredSourceRows.map(row => ({
            shipByDate: row[colIndices.shipByDate] || '',
            orderId: row[colIndices.orderNumber] || '',
            productTitle: row[colIndices.itemTitle] || '',
            quantity: row[colIndices.quantity] || '',
            sku: row[colIndices.usavSku] || '',
            condition: row[colIndices.condition] || '',
            shippingTrackingNumber: row[colIndices.tracking] || '',
            outOfStock: '', // OOS
            notes: row[colIndices.note] || '',
        }));

        const shippedToInsert = filteredSourceRows.map(row => ({
            dateTime: '', // Date / Time (empty)
            orderId: row[colIndices.orderNumber] || '',
            productTitle: row[colIndices.itemTitle] || '',
            condition: row[colIndices.condition] || '',
            shippingTrackingNumber: row[colIndices.tracking] || '',
            sku: row[colIndices.usavSku] || '',
        }));

        // 5. Concurrent upload to Sheets and DB
        const appendOrders = sheets.spreadsheets.values.append({
            spreadsheetId: DEST_SPREADSHEET_ID,
            range: `${ordersSheetName}!A:A`, 
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: processedOrdersRows },
        });

        const appendShipped = sheets.spreadsheets.values.append({
            spreadsheetId: DEST_SPREADSHEET_ID,
            range: `${shippedSheetName}!A:A`, 
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: processedShippedRows },
        });

        const dbInsertOrders = db.insert(ordersTable).values(ordersToInsert);
        const dbInsertShipped = db.insert(shippedTable).values(shippedToInsert);

        await Promise.all([appendOrders, appendShipped, dbInsertOrders, dbInsertShipped]);

        return NextResponse.json({ 
            success: true, 
            rowCount: processedOrdersRows.length, 
            tabName: targetTabName 
        });

    } catch (error: any) {
        console.error('Transfer error:', error);
        return NextResponse.json({ 
            success: false, 
            error: error.message || 'Internal Server Error' 
        }, { status: 500 });
    }
}
