import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';
import { db } from '@/lib/drizzle/db';
import { orders as ordersTable } from '@/lib/drizzle/schema';
import { desc, eq, inArray } from 'drizzle-orm';

const SOURCE_SPREADSHEET_ID = '1b8uvgk4q7jJPjGvFM2TQs3vMES1o9MiAfbEJ7P1TW9w';

function normalizeTracking(str: any) {
    if (!str) return '';
    return String(str).trim();
}

function isBlank(value: unknown) {
    return value === null || value === undefined || String(value).trim() === '';
}

async function runTransferOrders(manualSheetName?: string) {
    try {
        const auth = getGoogleAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        // 1. Find the most relevant source sheet tab
        const sourceSpreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SOURCE_SPREADSHEET_ID });

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

        // 2. Read the source tab from Master Sheet
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

        // 4. Preload orders by shipping_tracking_number from database.
        const sourceTrackings = Array.from(
            new Set(
                sourceRows
                    .slice(1)
                    .map(row => normalizeTracking(row[colIndices.tracking]))
                    .filter(Boolean)
            )
        );

        const sourceOrders = sourceTrackings.length > 0
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
                .where(inArray(ordersTable.shippingTrackingNumber, sourceTrackings))
                .orderBy(desc(ordersTable.createdAt))
            : [];

        const latestOrderByTracking = new Map<string, {
            id: number;
            tracking: string;
            orderId: string | null;
            shipByDate: Date | null;
            itemNumber: string | null;
            productTitle: string | null;
            quantity: string | null;
            sku: string | null;
            condition: string | null;
            notes: string | null;
        }>();
        sourceOrders.forEach(order => {
            const tracking = normalizeTracking(order.shippingTrackingNumber);
            const id = Number(order.id);
            if (!tracking || Number.isNaN(id) || latestOrderByTracking.has(tracking)) return;
            latestOrderByTracking.set(tracking, {
                id,
                tracking,
                orderId: order.orderId,
                shipByDate: order.shipByDate,
                itemNumber: order.itemNumber,
                productTitle: order.productTitle,
                quantity: order.quantity,
                sku: order.sku,
                condition: order.condition,
                notes: order.notes,
            });
        });

        // Keep one latest source row per tracking number (later rows override earlier rows).
        const latestSourceRowByTracking = new Map<string, any[]>();
        sourceRows.slice(1).forEach(row => {
            const tracking = normalizeTracking(row[colIndices.tracking]);
            if (!tracking) return;
            latestSourceRowByTracking.set(tracking, row);
        });

        // 5. Build insertion/update list for the orders table only.
        // - If shipping_tracking_number exists: use that DB row and backfill missing fields on that row.
        // - If shipping_tracking_number does not exist: insert a new orders row, even if order_id already exists.
        // This guarantees inserted rows never have empty shipping_tracking_number.
        const ordersToInsert: any[] = [];
        const ordersToBackfill: Array<{ id: number; values: Record<string, any> }> = [];

        latestSourceRowByTracking.forEach((row, trackingKey) => {
            const orderId = String(row[colIndices.orderNumber] || '').trim();
            const existingOrder = latestOrderByTracking.get(trackingKey);
            const dbTracking = normalizeTracking(existingOrder?.tracking);
            const sheetTracking = normalizeTracking(row[colIndices.tracking]);
            const resolvedTracking = sheetTracking || dbTracking;
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

            // Backfill any missing mapped fields for existing order rows.
            if (existingOrder) {
                const updateValues: Record<string, any> = {};
                if (isBlank(existingOrder.orderId) && orderId) updateValues.orderId = orderId;
                if (isBlank(existingOrder.itemNumber) && sheetItemNumber) updateValues.itemNumber = sheetItemNumber;
                if (isBlank(existingOrder.productTitle) && sheetProductTitle) updateValues.productTitle = sheetProductTitle;
                if (isBlank(existingOrder.quantity) && sheetQuantity) updateValues.quantity = sheetQuantity;
                if (isBlank(existingOrder.sku) && sheetSku) updateValues.sku = sheetSku;
                if (isBlank(existingOrder.condition) && sheetCondition) updateValues.condition = sheetCondition;
                if (isBlank(existingOrder.notes) && sheetNotes) updateValues.notes = sheetNotes;
                if (!existingOrder.shipByDate && sheetShipByDate) updateValues.shipByDate = sheetShipByDate;
                if (Object.keys(updateValues).length > 0) {
                    ordersToBackfill.push({ id: existingOrder.id, values: updateValues });
                }
            }

            // If tracking doesn't exist, insert into orders even when another row already has the same order_id.
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
        });

        // Apply DB sync
        if (ordersToBackfill.length > 0) {
            for (const entry of ordersToBackfill) {
                await db
                    .update(ordersTable)
                    .set(entry.values)
                    .where(eq(ordersTable.id, entry.id));
            }
        }

        if (ordersToInsert.length > 0) {
            await db.insert(ordersTable).values(ordersToInsert);
        }

        return NextResponse.json({ 
            success: true, 
            rowCount: ordersToInsert.length,
            processedRows: latestSourceRowByTracking.size,
            insertedOrders: ordersToInsert.length,
            updatedOrdersTracking: 0,
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

export async function GET() {
    return runTransferOrders();
}

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => ({}));
    const manualSheetName = body?.manualSheetName;
    return runTransferOrders(manualSheetName);
}
