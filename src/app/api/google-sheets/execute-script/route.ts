import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/drizzle/db';
import { orders, packerLogs } from '@/lib/drizzle/schema';
import { eq, inArray } from 'drizzle-orm';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';

const DEFAULT_SPREADSHEET_ID = '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';

export async function POST(req: NextRequest) {
    try {
        const { scriptName } = await req.json();

        switch (scriptName) {
            case 'removeDuplicateOrders':
                return await executeRemoveDuplicateOrders();
            case 'checkShippedOrders':
                return await executeCheckShippedOrders();
            case 'updateNonshippedOrders':
                return await executeUpdateNonshippedOrders();
            default:
                return NextResponse.json({ success: false, error: 'Unknown script name' }, { status: 400 });
        }
    } catch (error: any) {
        console.error('Script execution error:', error);
        return NextResponse.json({ success: false, error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}

async function executeRemoveDuplicateOrders() {
    // Get all orders
    const ordersData = await db.select().from(orders).orderBy(orders.id);
    
    const trackingMap = new Map();
    const idsToDelete: number[] = [];

    for (const order of ordersData) {
        const tracking = String(order.shippingTrackingNumber || '').trim();
        if (tracking) {
            if (trackingMap.has(tracking)) {
                // Duplicate found
                idsToDelete.push(order.id);
            } else {
                // First occurrence
                trackingMap.set(tracking, order.id);
            }
        }
    }

    // Delete duplicate orders
    if (idsToDelete.length > 0) {
        await db.delete(orders).where(inArray(orders.id, idsToDelete));
    }

    return NextResponse.json({ 
        success: true, 
        message: `Processed ${ordersData.length} orders. Removed ${idsToDelete.length} duplicate tracking numbers.` 
    });
}

async function executeCheckShippedOrders() {
    // Get all packer logs with tracking numbers
    const packerLogsData = await db.select().from(packerLogs);
    
    // Get all orders that are not yet marked as shipped
    const ordersData = await db.select().from(orders).where(eq(orders.isShipped, false));
    
    // Create a set of tracking numbers from packer logs for faster lookup
    const packerTrackingSet = new Set(
        packerLogsData
            .map(log => String(log.shippingTrackingNumber || '').trim())
            .filter(tracking => tracking !== '')
    );
    
    // Find orders that have matching tracking numbers in packer logs
    const ordersToUpdate: number[] = [];
    for (const order of ordersData) {
        const orderTracking = String(order.shippingTrackingNumber || '').trim();
        if (orderTracking && packerTrackingSet.has(orderTracking)) {
            ordersToUpdate.push(order.id);
        }
    }
    
    // Update orders to mark as shipped
    if (ordersToUpdate.length > 0) {
        await db
            .update(orders)
            .set({ isShipped: true })
            .where(inArray(orders.id, ordersToUpdate));
    }
    
    return NextResponse.json({ 
        success: true, 
        message: `Checked ${ordersData.length} orders. Updated ${ordersToUpdate.length} orders to shipped status.` 
    });
}

async function executeUpdateNonshippedOrders() {
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;

    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetNames = spreadsheet.data.sheets?.map(s => s.properties?.title || '') || [];
    const ordersSheetName = sheetNames.find(s => s.toLowerCase() === 'orders');

    if (!ordersSheetName) {
        return NextResponse.json({ success: false, error: 'Orders sheet not found' }, { status: 404 });
    }

    const response = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${ordersSheetName}!G2:G`,
    });

    const rows = response.data.values || [];
    const trackingSet = new Set<string>();
    for (const row of rows) {
        const tracking = String(row[0] || '').trim();
        if (tracking) trackingSet.add(tracking);
    }

    const trackingList = Array.from(trackingSet);
    if (trackingList.length === 0) {
        return NextResponse.json({ success: true, message: 'No tracking numbers found in Orders sheet column G.' });
    }

    let updatedCount = 0;
    const batchSize = 1000;
    for (let i = 0; i < trackingList.length; i += batchSize) {
        const batch = trackingList.slice(i, i + batchSize);
        const matchingOrders = await db
            .select({ id: orders.id })
            .from(orders)
            .where(inArray(orders.shippingTrackingNumber, batch));

        const idsToUpdate = matchingOrders.map(o => o.id);
        if (idsToUpdate.length > 0) {
            await db
                .update(orders)
                .set({ isShipped: false })
                .where(inArray(orders.id, idsToUpdate));
            updatedCount += idsToUpdate.length;
        }
    }

    return NextResponse.json({
        success: true,
        message: `Updated ${updatedCount} orders to non-shipped based on Orders sheet column G.`,
    });
}
