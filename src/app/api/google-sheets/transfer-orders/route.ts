import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';
import { db } from '@/lib/drizzle/db';
import { orders as ordersTable } from '@/lib/drizzle/schema';
import { sql } from 'drizzle-orm';

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

        // 2. Check NEON DB for existing tracking numbers (primary check)
        const existingOrdersInDb = await db.select({ tracking: ordersTable.shippingTrackingNumber }).from(ordersTable);
        
        const existingTrackingInNeon = new Set<string>();
        existingOrdersInDb.forEach(o => {
            const last8 = getLastEightDigits(o.tracking);
            if (last8) existingTrackingInNeon.add(last8);
        });

        // 3. Also check Google Sheets as fallback
        const shippedTrackingResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: DEST_SPREADSHEET_ID,
            range: `${shippedSheetName}!F2:F`, // Column F is tracking in Shipped sheet
        });

        const existingTrackingInSheets = new Set<string>();
        (shippedTrackingResponse.data.values || [])
            .flat()
            .filter(t => t && t.trim() !== '')
            .forEach(t => {
                const last8 = getLastEightDigits(t);
                if (last8) existingTrackingInSheets.add(last8);
            });

        // Combine both sets for deduplication
        const existingTracking = new Set<string>();
        existingTrackingInNeon.forEach(t => existingTracking.add(t));
        existingTrackingInSheets.forEach(t => existingTracking.add(t));

        // 4. Read the source tab from Master Sheet
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

        // 5. Process rows (only with tracking that contains numbers and NOT already in NEON DB or Sheets)
        const filteredSourceRows = sourceRows.slice(1).filter(row => {
            const tracking = row[colIndices.tracking];
            if (!tracking || tracking.trim() === '') return false;
            // Only include tracking numbers that contain at least one digit (ignore pure letter entries)
            if (!hasNumbers(tracking)) return false;
            return !existingTracking.has(getLastEightDigits(tracking));
        });

        if (filteredSourceRows.length === 0) {
            return NextResponse.json({ 
                success: true, 
                message: 'No new rows (not in NEON DB or Shipped) found', 
                rowCount: 0, 
                tabName: targetTabName 
            });
        }

        // Prepare data for Google Sheets (legacy support)
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
            const destRow = new Array(12).fill(''); // A to L (12 columns)
            destRow[0] = ''; // A = Pack Date/Time (empty, filled by packer)
            destRow[1] = row[colIndices.orderNumber] || ''; // B = Order ID
            destRow[2] = row[colIndices.itemTitle] || ''; // C = Product Title
            destRow[3] = row[colIndices.quantity] || ''; // D = Quantity
            destRow[4] = row[colIndices.condition] || ''; // E = Condition
            destRow[5] = row[colIndices.tracking] || ''; // F = Shipping TRK #
            // G, H, I remain empty (Serial Number, Packed By, Tested By - filled later)
            destRow[9] = row[colIndices.shipByDate] || ''; // J = Ship By Date
            destRow[10] = row[colIndices.usavSku] || ''; // K = SKU
            destRow[11] = row[colIndices.note] || ''; // L = Notes
            return destRow;
        });

        // 6. Smart import: Check if order_id exists and match tracking number
        const ordersToInsert = [];
        const sheetsOnlyRows = [];
        
        for (let i = 0; i < filteredSourceRows.length; i++) {
            const row = filteredSourceRows[i];
            const orderId = row[colIndices.orderNumber] || '';
            const trackingNumber = row[colIndices.tracking] || '';
            
            if (!orderId) continue;
            
            // Check if order_id exists in database
            const existingOrder = await db
                .select({ id: ordersTable.id, tracking: ordersTable.shippingTrackingNumber })
                .from(ordersTable)
                .where(sql`${ordersTable.orderId} = ${orderId}`)
                .limit(1);
            
            if (existingOrder.length > 0) {
                // Order exists - check if tracking matches
                const existingTracking = existingOrder[0].tracking || '';
                
                if (existingTracking !== trackingNumber) {
                    // Tracking doesn't match - this is a different order, import it
                    ordersToInsert.push({
                        shipByDate: row[colIndices.shipByDate] || '',
                        orderId: orderId,
                        productTitle: row[colIndices.itemTitle] || '',
                        sku: row[colIndices.usavSku] || '',
                        condition: row[colIndices.condition] || '',
                        shippingTrackingNumber: trackingNumber,
                        outOfStock: '',
                        notes: row[colIndices.note] || '',
                    });
                    sheetsOnlyRows.push(i); // Track for Google Sheets import
                } else {
                    console.log(`Skipping duplicate: order_id=${orderId}, tracking=${trackingNumber}`);
                }
            } else {
                // Order doesn't exist - import it
                ordersToInsert.push({
                    shipByDate: row[colIndices.shipByDate] || '',
                    orderId: orderId,
                    productTitle: row[colIndices.itemTitle] || '',
                    sku: row[colIndices.usavSku] || '',
                    condition: row[colIndices.condition] || '',
                    shippingTrackingNumber: trackingNumber,
                    outOfStock: '',
                    notes: row[colIndices.note] || '',
                });
                sheetsOnlyRows.push(i); // Track for Google Sheets import
            }
        }

        // Only insert non-duplicate orders
        if (ordersToInsert.length > 0) {
            await db.insert(ordersTable).values(ordersToInsert);
        }

        // Only append non-duplicate rows to Google Sheets
        const processedOrdersRowsFiltered = sheetsOnlyRows.map(i => processedOrdersRows[i]);
        const processedShippedRowsFiltered = sheetsOnlyRows.map(i => processedShippedRows[i]);

        const appendPromises = [];
        if (processedOrdersRowsFiltered.length > 0) {
            appendPromises.push(
                sheets.spreadsheets.values.append({
                    spreadsheetId: DEST_SPREADSHEET_ID,
                    range: `${ordersSheetName}!A:A`, 
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: processedOrdersRowsFiltered },
                })
            );
        }
        
        if (processedShippedRowsFiltered.length > 0) {
            appendPromises.push(
                sheets.spreadsheets.values.append({
                    spreadsheetId: DEST_SPREADSHEET_ID,
                    range: `${shippedSheetName}!A:A`, 
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: processedShippedRowsFiltered },
                })
            );
        }

        if (appendPromises.length > 0) {
            await Promise.all(appendPromises);
        }

        return NextResponse.json({ 
            success: true, 
            rowCount: ordersToInsert.length,
            skipped: filteredSourceRows.length - ordersToInsert.length,
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
