import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';
import { db } from '@/lib/drizzle/db';
import { orders as ordersTable, packerLogs } from '@/lib/drizzle/schema';
import { desc, inArray } from 'drizzle-orm';

const SOURCE_SPREADSHEET_ID = '1b8uvgk4q7jJPjGvFM2TQs3vMES1o9MiAfbEJ7P1TW9w';
const DEST_SPREADSHEET_ID = '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';

const ORDERS_GID = 719315456;
const SHIPPED_GID = 316829503;

function getLastEightDigits(str: any) {
    if (!str) return '';
    return String(str).trim().slice(-8).toLowerCase();
}

function normalizeTracking(str: any) {
    if (!str) return '';
    return String(str).trim();
}

function formatPackDateTimeForSheet(dateValue: Date | string | null) {
    if (!dateValue) return '';
    const date = dateValue instanceof Date ? dateValue : new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '';

    return new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(date);
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

        // 2. Check existing destination shipped sheet tracking for dedupe
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
            itemNumber: headerRow.indexOf('Item Number'),
            itemTitle: headerRow.indexOf('Item title'),
            quantity: headerRow.indexOf('Quantity'),
            usavSku: headerRow.indexOf('USAV SKU'),
            condition: headerRow.indexOf('Condition'),
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

        // 4. Preload orders by order_id from database (tracking comes from orders table)
        const orderIds = Array.from(
            new Set(
                sourceRows
                    .slice(1)
                    .map(row => String(row[colIndices.orderNumber] || '').trim())
                    .filter(Boolean)
            )
        );

        const sourceOrders = orderIds.length > 0
            ? await db
                .select({
                    orderId: ordersTable.orderId,
                    shippingTrackingNumber: ordersTable.shippingTrackingNumber,
                    createdAt: ordersTable.createdAt,
                })
                .from(ordersTable)
                .where(inArray(ordersTable.orderId, orderIds))
                .orderBy(desc(ordersTable.createdAt))
            : [];

        const orderToTracking = new Map<string, string>();
        sourceOrders.forEach(order => {
            const orderId = String(order.orderId || '').trim();
            const tracking = normalizeTracking(order.shippingTrackingNumber);
            if (!orderId || !tracking || orderToTracking.has(orderId)) return;
            orderToTracking.set(orderId, tracking);
        });

        // 5. Keep only rows with matching order_id in orders table + non-empty tracking
        // and not already transferred to shipped sheet.
        const transferRows = sourceRows.slice(1)
            .map(row => {
                const orderId = String(row[colIndices.orderNumber] || '').trim();
                const tracking = normalizeTracking(orderToTracking.get(orderId));
                return { row, orderId, tracking };
            })
            .filter(entry => {
                if (!entry.orderId) return false;
                if (!entry.tracking) return false; // Keep skip behavior for rows without tracking
                return !existingTrackingInSheets.has(getLastEightDigits(entry.tracking));
            });

        if (transferRows.length === 0) {
            return NextResponse.json({ 
                success: true, 
                message: 'No new rows with matching order_id + tracking found',
                rowCount: 0, 
                tabName: targetTabName 
            });
        }

        // 6. Get latest pack_date_time from packer_logs by tracking number
        const trackingNumbers = Array.from(new Set(transferRows.map(entry => entry.tracking)));
        const packerLogRows = trackingNumbers.length > 0
            ? await db
                .select({
                    tracking: packerLogs.shippingTrackingNumber,
                    packDateTime: packerLogs.packDateTime,
                    id: packerLogs.id,
                })
                .from(packerLogs)
                .where(inArray(packerLogs.shippingTrackingNumber, trackingNumbers))
                .orderBy(desc(packerLogs.packDateTime), desc(packerLogs.id))
            : [];

        const latestPackDateByTracking = new Map<string, string>();
        packerLogRows.forEach(log => {
            const tracking = normalizeTracking(log.tracking);
            if (!tracking || latestPackDateByTracking.has(tracking)) return;
            latestPackDateByTracking.set(tracking, formatPackDateTimeForSheet(log.packDateTime));
        });

        // Prepare data for Google Sheets
        const processedOrdersRows = transferRows.map(({ row, tracking }) => {
            const destRow = new Array(11).fill(''); // A to K
            destRow[0] = row[colIndices.shipByDate] || '';
            destRow[1] = row[colIndices.orderNumber] || '';
            destRow[2] = row[colIndices.itemTitle] || '';
            destRow[3] = row[colIndices.quantity] || '';
            destRow[4] = row[colIndices.usavSku] || '';
            destRow[5] = row[colIndices.condition] || '';
            destRow[6] = tracking || '';
            // I (index 8) is blank
            destRow[9] = row[colIndices.note] || ''; // J (index 9)
            destRow[10] = row[colIndices.itemNumber] || ''; // K (index 10) = Item Number
            return destRow;
        });

        const processedShippedRows = transferRows.map(({ row, tracking }) => {
            const destRow = new Array(12).fill(''); // A to L (12 columns)
            destRow[0] = latestPackDateByTracking.get(tracking) || ''; // A = Pack Date/Time
            destRow[1] = row[colIndices.orderNumber] || ''; // B = Order ID
            destRow[2] = row[colIndices.itemTitle] || ''; // C = Product Title
            destRow[3] = row[colIndices.quantity] || ''; // D = Quantity
            destRow[4] = row[colIndices.condition] || ''; // E = Condition
            destRow[5] = tracking || ''; // F = Shipping TRK #
            // G, H, I remain empty (Serial Number, Packed By, Tested By - filled later)
            destRow[9] = row[colIndices.shipByDate] || ''; // J = Ship By Date
            destRow[10] = row[colIndices.usavSku] || ''; // K = SKU
            destRow[11] = row[colIndices.note] || ''; // L = Notes
            return destRow;
        });

        const appendPromises = [];
        if (processedOrdersRows.length > 0) {
            appendPromises.push(
                sheets.spreadsheets.values.append({
                    spreadsheetId: DEST_SPREADSHEET_ID,
                    range: `${ordersSheetName}!A:A`, 
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: processedOrdersRows },
                })
            );
        }
        
        if (processedShippedRows.length > 0) {
            appendPromises.push(
                sheets.spreadsheets.values.append({
                    spreadsheetId: DEST_SPREADSHEET_ID,
                    range: `${shippedSheetName}!A:A`, 
                    valueInputOption: 'USER_ENTERED',
                    requestBody: { values: processedShippedRows },
                })
            );
        }

        if (appendPromises.length > 0) {
            await Promise.all(appendPromises);
        }

        return NextResponse.json({ 
            success: true, 
            rowCount: transferRows.length,
            skipped: sourceRows.length - 1 - transferRows.length,
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
