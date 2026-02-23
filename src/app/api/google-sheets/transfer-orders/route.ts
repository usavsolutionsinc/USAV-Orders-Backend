import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';
import { db } from '@/lib/drizzle/db';
import { orders as ordersTable, packerLogs } from '@/lib/drizzle/schema';
import { desc, eq, inArray } from 'drizzle-orm';

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

function isBlank(value: unknown) {
    return value === null || value === undefined || String(value).trim() === '';
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

        // 4. Preload orders by order_id from database.
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
                    id: ordersTable.id,
                    shipByDate: ordersTable.shipByDate,
                    itemNumber: ordersTable.itemNumber,
                    productTitle: ordersTable.productTitle,
                    quantity: ordersTable.quantity,
                    sku: ordersTable.sku,
                    condition: ordersTable.condition,
                    notes: ordersTable.notes,
                    shippingTrackingNumber: ordersTable.shippingTrackingNumber,
                    createdAt: ordersTable.createdAt,
                })
                .from(ordersTable)
                .where(inArray(ordersTable.orderId, orderIds))
                .orderBy(desc(ordersTable.createdAt))
            : [];

        const latestOrderById = new Map<string, {
            id: number;
            tracking: string;
            shipByDate: Date | null;
            itemNumber: string | null;
            productTitle: string | null;
            quantity: string | null;
            sku: string | null;
            condition: string | null;
            notes: string | null;
        }>();
        sourceOrders.forEach(order => {
            const orderId = String(order.orderId || '').trim();
            const tracking = normalizeTracking(order.shippingTrackingNumber);
            const id = Number(order.id);
            if (!orderId || Number.isNaN(id) || latestOrderById.has(orderId)) return;
            latestOrderById.set(orderId, {
                id,
                tracking,
                shipByDate: order.shipByDate,
                itemNumber: order.itemNumber,
                productTitle: order.productTitle,
                quantity: order.quantity,
                sku: order.sku,
                condition: order.condition,
                notes: order.notes,
            });
        });

        // Keep one latest source row per order_id (later rows override earlier rows).
        const latestSourceRowByOrderId = new Map<string, any[]>();
        sourceRows.slice(1).forEach(row => {
            const orderId = String(row[colIndices.orderNumber] || '').trim();
            if (!orderId) return;
            latestSourceRowByOrderId.set(orderId, row);
        });

        // 5. Build transfer list and insertion/update list:
        // - If order_id exists: use DB tracking when present, otherwise fallback to sheet tracking.
        // - If order_id does not exist: require non-empty sheet tracking, then insert into orders.
        // This guarantees inserted rows never have empty shipping_tracking_number.
        const transferRows: Array<{ row: any[]; orderId: string; tracking: string }> = [];
        const ordersToInsert: any[] = [];
        const orderIdsToUpdateTracking: string[] = [];
        const ordersToBackfill: Array<{ orderId: string; values: Record<string, any> }> = [];

        latestSourceRowByOrderId.forEach((row, orderId) => {
            const existingOrder = latestOrderById.get(orderId);
            const dbTracking = normalizeTracking(existingOrder?.tracking);
            const sheetTracking = normalizeTracking(row[colIndices.tracking]);
            const resolvedTracking = dbTracking || sheetTracking;
            const rawShipByDate = row[colIndices.shipByDate] || '';
            const parsedShipByDate = rawShipByDate ? new Date(rawShipByDate) : null;
            const sheetShipByDate = parsedShipByDate && !isNaN(parsedShipByDate.getTime()) ? parsedShipByDate : null;
            const sheetItemNumber = String(row[colIndices.itemNumber] || '').trim();
            const sheetProductTitle = String(row[colIndices.itemTitle] || '').trim();
            const sheetQuantity = String(row[colIndices.quantity] || '').trim() || '1';
            const sheetSku = String(row[colIndices.usavSku] || '').trim();
            const sheetCondition = String(row[colIndices.condition] || '').trim();
            const sheetNotes = String(row[colIndices.note] || '').trim();

            // Keep skip behavior for rows without tracking
            if (!resolvedTracking) return;

            // If order exists but tracking is empty in DB and present in sheet, backfill DB tracking.
            if (existingOrder && !dbTracking && sheetTracking) {
                orderIdsToUpdateTracking.push(orderId);
            }

            // Backfill any missing mapped fields for existing order rows.
            if (existingOrder) {
                const updateValues: Record<string, any> = {};
                if (isBlank(existingOrder.itemNumber) && sheetItemNumber) updateValues.itemNumber = sheetItemNumber;
                if (isBlank(existingOrder.productTitle) && sheetProductTitle) updateValues.productTitle = sheetProductTitle;
                if (isBlank(existingOrder.quantity) && sheetQuantity) updateValues.quantity = sheetQuantity;
                if (isBlank(existingOrder.sku) && sheetSku) updateValues.sku = sheetSku;
                if (isBlank(existingOrder.condition) && sheetCondition) updateValues.condition = sheetCondition;
                if (isBlank(existingOrder.notes) && sheetNotes) updateValues.notes = sheetNotes;
                if (!existingOrder.shipByDate && sheetShipByDate) updateValues.shipByDate = sheetShipByDate;
                if (Object.keys(updateValues).length > 0) {
                    ordersToBackfill.push({ orderId, values: updateValues });
                }
            }

            // If order doesn't exist, insert into orders only when sheet tracking exists.
            if (!existingOrder && sheetTracking) {
                ordersToInsert.push({
                    shipByDate: sheetShipByDate,
                    orderId,
                    itemNumber: sheetItemNumber || '',
                    productTitle: sheetProductTitle || '',
                    quantity: sheetQuantity || '1',
                    sku: sheetSku || '',
                    condition: sheetCondition || '',
                    shippingTrackingNumber: sheetTracking,
                    outOfStock: '',
                    notes: sheetNotes || '',
                    status: 'unassigned',
                    statusHistory: [],
                    isShipped: false,
                });
            }

            if (!existingTrackingInSheets.has(getLastEightDigits(resolvedTracking))) {
                transferRows.push({ row, orderId, tracking: resolvedTracking });
            }
        });

        if (transferRows.length === 0) {
            if (orderIdsToUpdateTracking.length > 0) {
                for (const orderId of orderIdsToUpdateTracking) {
                    const row = latestSourceRowByOrderId.get(orderId);
                    const sheetTracking = normalizeTracking(row?.[colIndices.tracking]);
                    if (!sheetTracking) continue;
                    await db
                        .update(ordersTable)
                        .set({ shippingTrackingNumber: sheetTracking })
                        .where(inArray(ordersTable.orderId, [orderId]));
                }
            }

            if (ordersToBackfill.length > 0) {
                for (const entry of ordersToBackfill) {
                    await db
                        .update(ordersTable)
                        .set(entry.values)
                        .where(eq(ordersTable.orderId, entry.orderId));
                }
            }

            if (ordersToInsert.length > 0) {
                await db.insert(ordersTable).values(ordersToInsert);
            }

            return NextResponse.json({ 
                success: true, 
                message: 'No new rows to transfer. Orders table synced.',
                rowCount: 0, 
                insertedOrders: ordersToInsert.length,
                updatedOrdersTracking: orderIdsToUpdateTracking.length,
                updatedOrdersFields: ordersToBackfill.length,
                tabName: targetTabName 
            });
        }

        // Apply DB sync before sheet append
        if (orderIdsToUpdateTracking.length > 0) {
            for (const orderId of orderIdsToUpdateTracking) {
                const row = latestSourceRowByOrderId.get(orderId);
                const sheetTracking = normalizeTracking(row?.[colIndices.tracking]);
                if (!sheetTracking) continue;
                await db
                    .update(ordersTable)
                    .set({ shippingTrackingNumber: sheetTracking })
                    .where(inArray(ordersTable.orderId, [orderId]));
            }
        }

        if (ordersToBackfill.length > 0) {
            for (const entry of ordersToBackfill) {
                await db
                    .update(ordersTable)
                    .set(entry.values)
                    .where(eq(ordersTable.orderId, entry.orderId));
            }
        }

        if (ordersToInsert.length > 0) {
            await db.insert(ordersTable).values(ordersToInsert);
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
            skipped: latestSourceRowByOrderId.size - transferRows.length,
            insertedOrders: ordersToInsert.length,
            updatedOrdersTracking: orderIdsToUpdateTracking.length,
            updatedOrdersFields: ordersToBackfill.length,
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
