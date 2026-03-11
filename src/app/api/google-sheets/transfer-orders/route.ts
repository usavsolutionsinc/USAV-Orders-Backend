import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';
import { db } from '@/lib/drizzle/db';
import pool from '@/lib/db';
import { customers as customersTable, orders as ordersTable } from '@/lib/drizzle/schema';
import { desc, eq, inArray } from 'drizzle-orm';

const SOURCE_SPREADSHEET_ID = '1b8uvgk4q7jJPjGvFM2TQs3vMES1o9MiAfbEJ7P1TW9w';

function normalizeTracking(str: any) {
    if (!str) return '';
    return String(str).trim();
}

function isBlank(value: unknown) {
    return value === null || value === undefined || String(value).trim() === '';
}

function compactUpdateValues(values: Record<string, unknown>) {
    return Object.fromEntries(
        Object.entries(values).filter(([_, value]) => {
            if (value === undefined) return false;
            if (typeof value === 'number' && !Number.isFinite(value)) return false;
            return true;
        })
    );
}

async function upsertOrderDeadline(orderId: number, deadlineAt: Date | null) {
    const existing = await pool.query(
        `SELECT id
         FROM work_assignments
         WHERE entity_type = 'ORDER'
           AND entity_id   = $1
           AND work_type   = 'TEST'
           AND status IN ('OPEN', 'ASSIGNED', 'IN_PROGRESS')
         ORDER BY
           CASE status WHEN 'ASSIGNED' THEN 1 WHEN 'IN_PROGRESS' THEN 2 WHEN 'OPEN' THEN 3 END,
           id DESC
         LIMIT 1`,
        [orderId]
    );

    if (existing.rows.length > 0) {
        await pool.query(
            `UPDATE work_assignments
             SET deadline_at = $1, updated_at = NOW()
             WHERE id = $2`,
            [deadlineAt, existing.rows[0].id]
        );
        return;
    }

    await pool.query(
        `INSERT INTO work_assignments
           (entity_type, entity_id, work_type, assigned_tech_id, status, priority, deadline_at)
         VALUES ('ORDER', $1, 'TEST', NULL, 'OPEN', 100, $2)
         ON CONFLICT DO NOTHING`,
        [orderId, deadlineAt]
    );
}

function pickLatestByKey<T extends { createdAt: Date | null }>(
    rows: T[],
    getKey: (row: T) => string
) {
    const result = new Map<string, T>();
    rows.forEach((row) => {
        const key = getKey(row);
        if (!key || result.has(key)) return;
        result.set(key, row);
    });
    return result;
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

        // 4. Preload the latest existing orders and customers using order_id first, then tracking as a fallback.
        const sourceOrderIds = Array.from(
            new Set(
                sourceRows
                    .slice(1)
                    .map(row => String(row[colIndices.orderNumber] || '').trim())
                    .filter(Boolean)
            )
        );

        const sourceTrackings = Array.from(
            new Set(
                sourceRows
                    .slice(1)
                    .map(row => normalizeTracking(row[colIndices.tracking]))
                    .filter(Boolean)
            )
        );

        const sourceOrdersByOrderId = sourceOrderIds.length > 0
            ? await db
                .select({
                    orderId: ordersTable.orderId,
                    id: ordersTable.id,
                    itemNumber: ordersTable.itemNumber,
                    productTitle: ordersTable.productTitle,
                    quantity: ordersTable.quantity,
                    sku: ordersTable.sku,
                    condition: ordersTable.condition,
                    notes: ordersTable.notes,
                    customerId: ordersTable.customerId,
                    shippingTrackingNumber: ordersTable.shippingTrackingNumber,
                    createdAt: ordersTable.createdAt,
                })
                .from(ordersTable)
                .where(inArray(ordersTable.orderId, sourceOrderIds))
                .orderBy(desc(ordersTable.createdAt))
            : [];

        const sourceOrdersByTracking = sourceTrackings.length > 0
            ? await db
                .select({
                    orderId: ordersTable.orderId,
                    id: ordersTable.id,
                    itemNumber: ordersTable.itemNumber,
                    productTitle: ordersTable.productTitle,
                    quantity: ordersTable.quantity,
                    sku: ordersTable.sku,
                    condition: ordersTable.condition,
                    notes: ordersTable.notes,
                    customerId: ordersTable.customerId,
                    shippingTrackingNumber: ordersTable.shippingTrackingNumber,
                    createdAt: ordersTable.createdAt,
                })
                .from(ordersTable)
                .where(inArray(ordersTable.shippingTrackingNumber, sourceTrackings))
                .orderBy(desc(ordersTable.createdAt))
            : [];

        const sourceCustomers = sourceOrderIds.length > 0
            ? await db
                .select({
                    id: customersTable.id,
                    orderId: customersTable.orderId,
                    createdAt: customersTable.createdAt,
                })
                .from(customersTable)
                .where(inArray(customersTable.orderId, sourceOrderIds))
                .orderBy(desc(customersTable.createdAt))
            : [];

        const latestBlankTrackingOrderByOrderId = new Map<string, {
            id: number;
            orderId: string | null;
            itemNumber: string | null;
            productTitle: string | null;
            quantity: string | null;
            sku: string | null;
            condition: string | null;
            notes: string | null;
            customerId: number | null;
            tracking: string;
        }>();
        sourceOrdersByOrderId.forEach(order => {
            const key = String(order.orderId || '').trim();
            const tracking = normalizeTracking(order.shippingTrackingNumber);
            const id = Number(order.id);
            if (!key || tracking || Number.isNaN(id) || latestBlankTrackingOrderByOrderId.has(key)) return;
            latestBlankTrackingOrderByOrderId.set(key, {
                id,
                orderId: order.orderId,
                itemNumber: order.itemNumber,
                productTitle: order.productTitle,
                quantity: order.quantity,
                sku: order.sku,
                condition: order.condition,
                notes: order.notes,
                customerId: order.customerId,
                tracking,
            });
        });

        const latestOrderByTracking = new Map<string, {
            id: number;
            tracking: string;
            orderId: string | null;
            itemNumber: string | null;
            productTitle: string | null;
            quantity: string | null;
            sku: string | null;
            condition: string | null;
            notes: string | null;
            customerId: number | null;
        }>();
        sourceOrdersByTracking.forEach(order => {
            const tracking = normalizeTracking(order.shippingTrackingNumber);
            const id = Number(order.id);
            if (!tracking || Number.isNaN(id) || latestOrderByTracking.has(tracking)) return;
            latestOrderByTracking.set(tracking, {
                id,
                tracking,
                orderId: order.orderId,
                itemNumber: order.itemNumber,
                productTitle: order.productTitle,
                quantity: order.quantity,
                sku: order.sku,
                condition: order.condition,
                notes: order.notes,
                customerId: order.customerId,
            });
        });

        const latestCustomerByOrderId = pickLatestByKey(sourceCustomers, (customer) =>
            String(customer.orderId || '').trim()
        );

        // Keep one source row per tracking number. For rows without tracking, fall back to order_id
        // so re-running the transfer does not create duplicates for blank-tracking orders.
        const latestSourceRowByKey = new Map<string, any[]>();
        sourceRows.slice(1).forEach(row => {
            const orderId = String(row[colIndices.orderNumber] || '').trim();
            const tracking = normalizeTracking(row[colIndices.tracking]);
            const key = tracking ? `tracking:${tracking}` : orderId ? `order:${orderId}` : '';
            if (!key) return;
            latestSourceRowByKey.set(key, row);
        });

        // 5. Build insertion/update list for the orders table.
        // Store unshipped orders even when tracking is blank, and only fill fields when the DB value is empty.
        const ordersToInsert: Array<{ values: Record<string, unknown>; shipByDate: Date | null }> = [];
        const ordersToBackfill: Array<{ id: number; values: Record<string, unknown> }> = [];
        const orderDeadlinesToUpsert: Array<{ id: number; shipByDate: Date | null }> = [];
        let matchedCustomers = 0;
        let unmatchedCustomers = 0;

        latestSourceRowByKey.forEach((row) => {
            const orderId = String(row[colIndices.orderNumber] || '').trim();
            const sheetTracking = normalizeTracking(row[colIndices.tracking]);
            const existingOrder = sheetTracking
                ? latestOrderByTracking.get(sheetTracking)
                : (orderId ? latestBlankTrackingOrderByOrderId.get(orderId) : undefined);
            const rawShipByDate = row[colIndices.shipByDate] || '';
            const parsedShipByDate = rawShipByDate ? new Date(rawShipByDate) : null;
            const sheetShipByDate = parsedShipByDate && !isNaN(parsedShipByDate.getTime()) ? parsedShipByDate : null;
            const sheetItemNumber = String(row[colIndices.itemNumber] || '').trim();
            const sheetProductTitle = String(row[colIndices.itemTitle] || '').trim();
            const sheetQuantity = String(row[colIndices.quantity] || '').trim() || '1';
            const sheetSku = String(row[colIndices.usavSku] || '').trim();
            const sheetCondition = String(row[colIndices.condition] || '').trim();
            const sheetNotes = String(row[colIndices.note] || '').trim();
            const matchedCustomer = orderId ? latestCustomerByOrderId.get(orderId) : undefined;
            const matchedCustomerId = matchedCustomer ? Number(matchedCustomer.id) : NaN;
            const customerId = Number.isFinite(matchedCustomerId) ? matchedCustomerId : null;

            if (customerId) {
                matchedCustomers++;
            } else {
                unmatchedCustomers++;
            }

            if (!orderId && !sheetTracking) return;

            if (existingOrder) {
                const updateValues: Record<string, any> = {};
                if (isBlank(existingOrder.orderId) && orderId) updateValues.orderId = orderId;
                if (isBlank(existingOrder.itemNumber) && sheetItemNumber) updateValues.itemNumber = sheetItemNumber;
                if (isBlank(existingOrder.productTitle) && sheetProductTitle) updateValues.productTitle = sheetProductTitle;
                if (isBlank(existingOrder.quantity) && sheetQuantity) updateValues.quantity = sheetQuantity;
                if (isBlank(existingOrder.sku) && sheetSku) updateValues.sku = sheetSku;
                if (isBlank(existingOrder.condition) && sheetCondition) updateValues.condition = sheetCondition;
                if (isBlank(existingOrder.notes) && sheetNotes) updateValues.notes = sheetNotes;
                if (isBlank(existingOrder.tracking) && sheetTracking) updateValues.shippingTrackingNumber = sheetTracking;
                if (existingOrder.customerId == null && customerId) updateValues.customerId = customerId;
                const compactedUpdateValues = compactUpdateValues(updateValues);
                if (Object.keys(compactedUpdateValues).length > 0) {
                    ordersToBackfill.push({ id: existingOrder.id, values: compactedUpdateValues });
                }
                if (sheetShipByDate) {
                    orderDeadlinesToUpsert.push({ id: existingOrder.id, shipByDate: sheetShipByDate });
                }
            } else {
                ordersToInsert.push({
                    shipByDate: sheetShipByDate,
                    values: {
                        orderId,
                        itemNumber: sheetItemNumber || '',
                        productTitle: sheetProductTitle || '',
                        quantity: sheetQuantity || '1',
                        sku: sheetSku || '',
                        condition: sheetCondition || '',
                        shippingTrackingNumber: sheetTracking || '',
                        outOfStock: '',
                        notes: sheetNotes || '',
                        status: 'unassigned',
                        statusHistory: [],
                        isShipped: false,
                        customerId,
                    },
                });
            }
        });

        // Apply DB sync
        if (ordersToBackfill.length > 0) {
            for (const entry of ordersToBackfill) {
                const compactedUpdateValues = compactUpdateValues(entry.values);
                if (Object.keys(compactedUpdateValues).length === 0) continue;
                await db
                    .update(ordersTable)
                    .set(compactedUpdateValues)
                    .where(eq(ordersTable.id, entry.id));
            }
        }

        if (ordersToInsert.length > 0) {
            const insertedOrders = await db
                .insert(ordersTable)
                .values(ordersToInsert.map((entry) => entry.values))
                .returning({ id: ordersTable.id });

            insertedOrders.forEach((order, index) => {
                const shipByDate = ordersToInsert[index]?.shipByDate ?? null;
                if (shipByDate) {
                    orderDeadlinesToUpsert.push({ id: order.id, shipByDate });
                }
            });
        }

        if (orderDeadlinesToUpsert.length > 0) {
            for (const entry of orderDeadlinesToUpsert) {
                await upsertOrderDeadline(entry.id, entry.shipByDate);
            }
        }

        return NextResponse.json({ 
            success: true, 
            rowCount: ordersToInsert.length,
            processedRows: latestSourceRowByKey.size,
            insertedOrders: ordersToInsert.length,
            updatedOrdersTracking: 0,
            updatedOrdersFields: ordersToBackfill.length,
            matchedCustomers,
            unmatchedCustomers,
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

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => ({}));
    const manualSheetName = body?.manualSheetName;
    return runTransferOrders(manualSheetName);
}
