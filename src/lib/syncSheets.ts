/**
 * Google Sheets to Neon DB Sync
 * TypeScript implementation for Vercel serverless environment
 */

import { google } from 'googleapis';
import pool from './db';

interface SheetRow {
    [key: string]: string | number | null | undefined;
}

function parseTimestamp(timestamp: string | number | null | undefined): Date | null {
    if (!timestamp || timestamp === '') return null;
    
    try {
        const timestampStr = String(timestamp);
        // Try various timestamp formats
        const formats = [
            /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})/, // MM/DD/YYYY HH:MM:SS
            /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{1,2})/, // MM/DD/YYYY HH:MM
            /^(\d{1,2})\/(\d{1,2})\/(\d{4})/, // MM/DD/YYYY
        ];
        
        for (const format of formats) {
            const match = timestampStr.match(format);
            if (match) {
                const [, month, day, year, hour = '0', minute = '0', second = '0'] = match;
                return new Date(
                    parseInt(year),
                    parseInt(month) - 1,
                    parseInt(day),
                    parseInt(hour),
                    parseInt(minute),
                    parseInt(second)
                );
            }
        }
        
        // Try ISO format
        const isoDate = new Date(timestampStr);
        if (!isNaN(isoDate.getTime())) return isoDate;
        
        return null;
    } catch {
        return null;
    }
}

function parseIntSafe(value: string | number | null | undefined): number | null {
    if (!value) return null;
    const parsed = parseInt(String(value));
    return isNaN(parsed) ? null : parsed;
}

async function getGoogleSheetsClient() {
    const auth = new google.auth.JWT({
        email: process.env.GOOGLE_CLIENT_EMAIL,
        key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        scopes: [
            'https://www.googleapis.com/auth/spreadsheets.readonly',
            'https://www.googleapis.com/auth/drive.readonly',
        ],
    });
    
    return google.sheets({ version: 'v4', auth });
}

async function findSpreadsheetId(sheets: any): Promise<string | null> {
    try {
        console.log('Attempting to auto-detect spreadsheet...');
        // Use Drive API to list accessible spreadsheets
        const drive = google.drive({ version: 'v3', auth: sheets.auth });
        const response = await drive.files.list({
            q: "mimeType='application/vnd.google-apps.spreadsheet'",
            fields: 'files(id, name)',
            pageSize: 50,
        });
        
        // Look for spreadsheets that contain our expected sheet names
        const expectedSheets = ['orders', 'tech_1', 'Packer_1', 'receiving', 'shipped'];
        
        for (const file of response.data.files || []) {
            try {
                const sheetMetadata = await sheets.spreadsheets.get({
                    spreadsheetId: file.id!,
                });
                
                const sheetNames = (sheetMetadata.data.sheets || []).map((s: any) => s.properties?.title || '').map((n: string) => n.toLowerCase());
                const hasExpectedSheets = expectedSheets.some(expected => 
                    sheetNames.includes(expected.toLowerCase())
                );
                
                if (hasExpectedSheets) {
                    console.log(`✓ Found matching spreadsheet: "${file.name}" (ID: ${file.id})`);
                    return file.id!;
                }
            } catch (e) {
                // Skip if we can't access this spreadsheet
                continue;
            }
        }
        
        console.log('Could not auto-detect spreadsheet');
        return null;
    } catch (error) {
        console.error('Error finding spreadsheet:', error);
        return null;
    }
}

async function getSheetData(sheets: any, spreadsheetId: string, range: string): Promise<SheetRow[]> {
    try {
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range,
        });
        
        const rows = response.data.values;
        if (!rows || rows.length < 2) return [];
        
        const headers = rows[0].map((h: string) => String(h).trim());
        const data: SheetRow[] = [];
        
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const rowData: SheetRow = {};
            let hasData = false;
            
            for (let j = 0; j < headers.length; j++) {
                const value = row[j] ? String(row[j]).trim() : '';
                if (value) hasData = true;
                rowData[headers[j]] = value || null;
            }
            
            if (hasData) {
                data.push(rowData);
            }
        }
        
        return data;
    } catch (error) {
        console.error(`Error fetching sheet ${range}:`, error);
        return [];
    }
}

export async function syncOrders(conn: any, data: SheetRow[]) {
    const client = await conn.connect();
    try {
        for (const row of data) {
            const orderId = row['Order ID'] || row['order_id'] || row['Order ID'];
            if (!orderId) continue;
            
            await client.query(`
                INSERT INTO orders (
                    id, order_id, size, platform, buyer_name, product_title, quantity,
                    ship, sku, item_index, asin, shipping_trk_number, oos_needed,
                    receiving_trk_number, stock_status_location, notes
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                ON CONFLICT (id) DO UPDATE SET
                    size = EXCLUDED.size,
                    platform = EXCLUDED.platform,
                    order_id = EXCLUDED.order_id,
                    buyer_name = EXCLUDED.buyer_name,
                    product_title = EXCLUDED.product_title,
                    quantity = EXCLUDED.quantity,
                    ship = EXCLUDED.ship,
                    sku = EXCLUDED.sku,
                    item_index = EXCLUDED.item_index,
                    asin = EXCLUDED.asin,
                    shipping_trk_number = EXCLUDED.shipping_trk_number,
                    oos_needed = EXCLUDED.oos_needed,
                    receiving_trk_number = EXCLUDED.receiving_trk_number,
                    stock_status_location = EXCLUDED.stock_status_location,
                    notes = EXCLUDED.notes
            `, [
                orderId,
                orderId,
                row['SIZE'] || row['Size'] || row['size'] || null,
                row['Platform'] || row['platform'] || null,
                row['Buyer Name'] || row['buyer_name'] || row['Buyer Name'] || null,
                row['Product Title'] || row['product_title'] || row['Product Title'] || null,
                parseIntSafe(row['#'] || row['quantity'] || row['Qty']),
                row['Ship'] || row['ship'] || null,
                row['SKU'] || row['sku'] || row['SKU'] || null,
                row['Item #'] || row['item_index'] || row['Item #'] || null,
                row['As'] || row['asin'] || row['As'] || null,
                row['Shipping TRK #'] || row['shipping_trk_number'] || row['Shipping TRK #'] || null,
                row['OOS - We Need'] || row['oos_needed'] || row['OOS - We Need'] || null,
                row['Receiving TRK #'] || row['receiving_trk_number'] || row['Receiving TRK #'] || null,
                row['Stock Status / Location'] || row['stock_status_location'] || row['Stock Status / Location'] || null,
                row['Notes'] || row['notes'] || row['Notes'] || null,
            ]);
        }
        console.log(`✓ Synced ${data.length} orders`);
    } catch (error) {
        console.error('❌ Error syncing orders:', error);
        throw error;
    } finally {
        client.release();
    }
}

export async function syncTechTable(conn: any, techNum: number, data: SheetRow[]) {
    const client = await conn.connect();
    const tableName = `tech_${techNum}`;
    try {
        for (const row of data) {
            await client.query(`
                INSERT INTO ${tableName} (
                    date_time, title_testing, shipping_trk_testing, serial_number_data,
                    input, asin, sku, quantity, tech_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT DO NOTHING
            `, [
                parseTimestamp(row['Date / Time'] || row['date_time'] || row['Date / Time']),
                row['Title - Testing'] || row['title_testing'] || row['Title - Testing'] || null,
                row['Shipping TRK # / Testing'] || row['shipping_trk_testing'] || row['Shipping TRK # / Testing'] || null,
                row['Serial Number Data'] || row['serial_number_data'] || row['Serial Number Data'] || null,
                row['Input'] || row['input'] || row['Input'] || null,
                row['As'] || row['asin'] || row['As'] || null,
                row['SKU'] || row['sku'] || row['SKU'] || null,
                parseIntSafe(row['#'] || row['quantity'] || row['Qty']),
                String(techNum),
            ]);
        }
        console.log(`✓ Synced ${data.length} rows to ${tableName}`);
    } catch (error) {
        console.error(`❌ Error syncing ${tableName}:`, error);
        throw error;
    } finally {
        client.release();
    }
}

export async function syncPackerTable(conn: any, packerNum: number, data: SheetRow[]) {
    const client = await conn.connect();
    const tableName = `Packer_${packerNum}`;
    try {
        for (const row of data) {
            await client.query(`
                INSERT INTO ${tableName} (
                    date_time, tracking_number_fnsku, order_id, product_title, quantity, packer_id
                ) VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT DO NOTHING
            `, [
                parseTimestamp(row['Date / Time'] || row['date_time'] || row['Date / Time']),
                row['Tracking Number/FNSKU'] || row['tracking_number_fnsku'] || row['Tracking Number/FNSKU'] || null,
                row['ID'] || row['order_id'] || row['ID'] || null,
                row['Product Title'] || row['product_title'] || row['Product Title'] || null,
                parseIntSafe(row['#'] || row['quantity'] || row['Qty']),
                String(packerNum),
            ]);
        }
        console.log(`✓ Synced ${data.length} rows to ${tableName}`);
    } catch (error) {
        console.error(`❌ Error syncing ${tableName}:`, error);
        throw error;
    } finally {
        client.release();
    }
}

export async function syncReceiving(conn: any, data: SheetRow[]) {
    const client = await conn.connect();
    try {
        for (const row of data) {
            await client.query(`
                INSERT INTO receiving (
                    date_time, tracking_number, carrier, qty
                ) VALUES ($1, $2, $3, $4)
                ON CONFLICT DO NOTHING
            `, [
                parseTimestamp(row['Date / Time'] || row['date_time'] || row['Date / Time']),
                row['Tracking Number'] || row['tracking_number'] || row['Tracking Number'] || null,
                row['Carrier'] || row['carrier'] || row['Carrier'] || null,
                parseIntSafe(row['Qty'] || row['quantity'] || row['Qty']),
            ]);
        }
        console.log(`✓ Synced ${data.length} receiving items`);
    } catch (error) {
        console.error('❌ Error syncing receiving:', error);
        throw error;
    } finally {
        client.release();
    }
}

export async function syncShipped(conn: any, data: SheetRow[]) {
    const client = await conn.connect();
    try {
        for (const row of data) {
            await client.query(`
                INSERT INTO shipped (
                    date_time, order_id, product_title, sent, shipping_trk_number,
                    serial_number, box, by_name, sku, status
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT DO NOTHING
            `, [
                parseTimestamp(row['Date / Time'] || row['date_time'] || row['Date / Time']) || new Date(),
                row['Order ID'] || row['order_id'] || row['Order ID'] || null,
                row['Product Title'] || row['product_title'] || row['Product Title'] || null,
                row['Sent'] || row['sent'] || row['Sent'] || null,
                row['Shipping TRK #'] || row['shipping_trk_number'] || row['Shipping TRK #'] || null,
                row['Serial Number'] || row['serial_number'] || row['Serial Number'] || null,
                row['Box'] || row['box'] || row['Box'] || null,
                row['By'] || row['by_name'] || row['By'] || null,
                row['SKU'] || row['sku'] || row['SKU'] || null,
                row['Status'] || row['status'] || row['Status'] || null,
            ]);
        }
        console.log(`✓ Synced ${data.length} shipped items`);
    } catch (error) {
        console.error('❌ Error syncing shipped:', error);
        throw error;
    } finally {
        client.release();
    }
}

export async function syncSkuStock(conn: any, data: SheetRow[]) {
    const client = await conn.connect();
    try {
        for (const row of data) {
            const sku = row['SKU'] || row['sku'] || row['SKU'];
            if (!sku) continue;
            
            await client.query(`
                INSERT INTO sku_stock (
                    sku, size, title, condition, quantity
                ) VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (sku) DO UPDATE SET
                    size = EXCLUDED.size,
                    title = EXCLUDED.title,
                    condition = EXCLUDED.condition,
                    quantity = EXCLUDED.quantity
            `, [
                sku,
                row['Size'] || row['size'] || row['Size'] || null,
                row['Title'] || row['title'] || row['Title'] || null,
                row['Condition'] || row['condition'] || row['Condition'] || null,
                parseIntSafe(row['Quantity'] || row['quantity'] || row['Qty']) || 0,
            ]);
        }
        console.log(`✓ Synced ${data.length} SKU stock items`);
    } catch (error) {
        console.error('❌ Error syncing sku_stock:', error);
        throw error;
    } finally {
        client.release();
    }
}

export async function syncSku(conn: any, data: SheetRow[]) {
    const client = await conn.connect();
    try {
        for (const row of data) {
            await client.query(`
                INSERT INTO skus (
                    store_date_time, static_sku, serial_numbers, shipping_trk_number,
                    product_title, size, notes, location
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT DO NOTHING
            `, [
                parseTimestamp(row['Store Date / Time'] || row['store_date_time'] || row['Store Date / Time']),
                row['Static SKU'] || row['static_sku'] || row['Static SKU'] || null,
                row['Serial Numbers'] || row['serial_numbers'] || row['Serial Numbers'] || null,
                row['Shipping TRK #'] || row['shipping_trk_number'] || row['Shipping TRK #'] || null,
                row['Product Title'] || row['product_title'] || row['Product Title'] || null,
                row['Size'] || row['size'] || row['Size'] || null,
                row['Notes'] || row['notes'] || row['Notes'] || null,
                row['Location'] || row['location'] || row['Location'] || null,
            ]);
        }
        console.log(`✓ Synced ${data.length} SKUs`);
    } catch (error) {
        console.error('❌ Error syncing skus:', error);
        throw error;
    } finally {
        client.release();
    }
}


export async function syncAllSheets() {
    let spreadsheetId = process.env.GOOGLE_SHEET_ID;
    
    console.log('Starting Google Sheets to Neon DB sync (TypeScript)...\n');
    
    // If GOOGLE_SHEET_ID is not set, try to find it automatically
    if (!spreadsheetId) {
        console.log('GOOGLE_SHEET_ID not set, attempting to find spreadsheet automatically...');
        const sheets = await getGoogleSheetsClient();
        const foundId = await findSpreadsheetId(sheets);
        
        if (foundId) {
            spreadsheetId = foundId;
            console.log(`Using automatically detected spreadsheet ID: ${spreadsheetId}`);
        } else {
            throw new Error('GOOGLE_SHEET_ID not set and could not be automatically detected. Please set GOOGLE_SHEET_ID in environment variables or ensure the service account has access to the spreadsheet.');
        }
    }
    
    const sheets = await getGoogleSheetsClient();
    const conn = pool;
    
    try {
        // Sync orders
        const ordersData = await getSheetData(sheets, spreadsheetId, 'orders!A:P');
        if (ordersData.length > 0) {
            await syncOrders(conn, ordersData);
        }
        
        // Sync tech tables (1-3)
        for (let techNum = 1; techNum <= 3; techNum++) {
            const techData = await getSheetData(sheets, spreadsheetId, `tech_${techNum}!A:H`);
            if (techData.length > 0) {
                await syncTechTable(conn, techNum, techData);
            }
        }
        
        // Sync packer tables (1-3)
        for (let packerNum = 1; packerNum <= 3; packerNum++) {
            const packerData = await getSheetData(sheets, spreadsheetId, `Packer_${packerNum}!A:D`);
            if (packerData.length > 0) {
                await syncPackerTable(conn, packerNum, packerData);
            }
        }
        
        // Sync receiving
        const receivingData = await getSheetData(sheets, spreadsheetId, 'receiving!A:D');
        if (receivingData.length > 0) {
            await syncReceiving(conn, receivingData);
        }
        
        // Sync shipped
        const shippedData = await getSheetData(sheets, spreadsheetId, 'shipped!A:J');
        if (shippedData.length > 0) {
            await syncShipped(conn, shippedData);
        }
        
        // Sync sku-stock
        const skuStockData = await getSheetData(sheets, spreadsheetId, 'Sku-Stock!A:E');
        if (skuStockData.length > 0) {
            await syncSkuStock(conn, skuStockData);
        }
        
        // Sync sku
        const skuData = await getSheetData(sheets, spreadsheetId, 'sku!A:H');
        if (skuData.length > 0) {
            await syncSku(conn, skuData);
        }
        
        console.log('\n✅ All sheets synced successfully!');
        return { success: true, message: 'All sheets synced successfully' };
    } catch (error: any) {
        console.error('\n❌ Sync failed:', error);
        throw error;
    }
}
