import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';

const SPREADSHEET_ID = '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';

export async function POST(req: NextRequest) {
    try {
        const { scriptName } = await req.json();
        const auth = getGoogleAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        switch (scriptName) {
            case 'checkTrackingInShipped':
                return await executeCheckTrackingInShipped(sheets);
            case 'removeDuplicateShipped':
                return await executeRemoveDuplicateShipped(sheets);
            case 'transferExistingOrdersToRestock':
                return await executeTransferExistingOrdersToRestock(sheets);
            case 'calculateLateOrders':
                return await executeCalculateLateOrders(sheets);
            case 'removeDuplicateOrders':
                return await executeRemoveDuplicateOrders(sheets);
            case 'updateSkuStockFromShipped':
                return await executeUpdateSkuStockFromShipped(sheets);
            default:
                return NextResponse.json({ success: false, error: 'Unknown script name' }, { status: 400 });
        }
    } catch (error: any) {
        console.error('Script execution error:', error);
        return NextResponse.json({ success: false, error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}

async function executeCheckTrackingInShipped(sheets: any) {
    // 1. Get Orders data (A to G)
    const ordersResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Orders!A2:G',
    });
    const ordersRows = ordersResponse.data.values || [];

    // 2. Get Shipped tracking numbers (E column)
    const shippedResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Shipped!E2:E',
    });
    const shippedTracking = new Set((shippedResponse.data.values || []).flat().map((t: any) => String(t).trim().slice(-8).toLowerCase()));

    const rowsToAdd = [];
    for (const row of ordersRows) {
        const tracking = String(row[6] || '').trim();
        if (tracking && !shippedTracking.has(tracking.slice(-8).toLowerCase())) {
            const newRow = new Array(9).fill("");
            newRow[1] = row[1]; // Order ID
            newRow[2] = row[2]; // Product Title
            newRow[3] = row[5]; // Condition/Sent
            newRow[4] = row[6]; // Shipping TRK #
            rowsToAdd.push(newRow);
            shippedTracking.add(tracking.slice(-8).toLowerCase());
        }
    }

    if (rowsToAdd.length > 0) {
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Shipped!A:A',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: rowsToAdd },
        });
    }

    return NextResponse.json({ success: true, message: `Transferred ${rowsToAdd.length} rows to Shipped.` });
}

async function executeRemoveDuplicateShipped(sheets: any) {
    const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Shipped!E2:E',
    });
    const rows = response.data.values || [];
    const trackingMap = new Map();
    const deleteRequests = [];

    for (let i = 0; i < rows.length; i++) {
        const tracking = String(rows[i][0] || '').trim();
        if (tracking) {
            if (trackingMap.has(tracking)) {
                // Mark for deletion (index is 0-based relative to A2, so actual row is i + 2)
                deleteRequests.push(i + 2);
            } else {
                trackingMap.set(tracking, true);
            }
        }
    }

    if (deleteRequests.length > 0) {
        // Sort descending to delete from bottom up
        deleteRequests.sort((a, b) => b - a);
        // Note: Real batch delete requires batchUpdate with deleteDimension
        // For simplicity in this demo, we'll return the count.
        // A full implementation would use sheets.spreadsheets.batchUpdate
    }

    return NextResponse.json({ success: true, message: `Found ${deleteRequests.length} duplicates in Shipped.` });
}

async function executeTransferExistingOrdersToRestock(sheets: any) {
    // Get Shipped A (timestamp), B (Order ID), E (Tracking)
    const shippedResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Shipped!A2:E',
    });
    const shippedRows = shippedResponse.data.values || [];
    const shippedWithTimestamps = new Set();
    const shippedOrdersWithTimestamps = new Set();

    for (const row of shippedRows) {
        if (row[0]) { // If A column has timestamp
            if (row[4]) shippedWithTimestamps.add(String(row[4]).trim().slice(-8).toLowerCase());
            if (row[1]) shippedOrdersWithTimestamps.add(String(row[1]).trim());
        }
    }

    // Get Orders B (Order ID), G (Tracking)
    const ordersResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Orders!B2:G',
    });
    const ordersRows = ordersResponse.data.values || [];
    let deleteCount = 0;

    for (let i = 0; i < ordersRows.length; i++) {
        const orderId = String(ordersRows[i][0] || '').trim();
        const tracking = String(ordersRows[i][5] || '').trim();
        if ((tracking && shippedWithTimestamps.has(tracking.slice(-8).toLowerCase())) || 
            (orderId && shippedOrdersWithTimestamps.has(orderId))) {
            deleteCount++;
        }
    }

    return NextResponse.json({ success: true, message: `Identified ${deleteCount} orders to delete from Orders sheet.` });
}

async function executeCalculateLateOrders(sheets: any) {
    // This involves sorting and updating column H.
    return NextResponse.json({ success: true, message: 'Late orders calculation completed (Simulation).' });
}

async function executeRemoveDuplicateOrders(sheets: any) {
    return NextResponse.json({ success: true, message: 'Duplicate orders removal completed (Simulation).' });
}

async function executeUpdateSkuStockFromShipped(sheets: any) {
    const shippedResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Shipped!I2:I',
    });
    const shippedSkus = new Set((shippedResponse.data.values || []).flat().map((s: any) => String(s).trim().toLowerCase()));

    const skuStockResponse = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'Sku-Stock!B2:B',
    });
    const skuStockRows = skuStockResponse.data.values || [];
    const updates = [];

    for (let i = 0; i < skuStockRows.length; i++) {
        const sku = String(skuStockRows[i][0] || '').trim().toLowerCase();
        if (sku && shippedSkus.has(sku)) {
            updates.push({
                range: `Sku-Stock!F${i + 2}`,
                values: [[1]]
            });
        }
    }

    if (updates.length > 0) {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data: updates
            }
        });
    }

    return NextResponse.json({ success: true, message: `Updated ${updates.length} rows in Sku-Stock.` });
}
