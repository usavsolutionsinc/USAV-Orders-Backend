/**
 * Google Sheets to Neon DB Sync
 * TypeScript implementation for Vercel serverless environment
 * Uses position-based column mapping (A→A, B→B, etc.)
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

async function getSheetNames(sheets: any, spreadsheetId: string): Promise<string[]> {
    try {
        const metadata = await sheets.spreadsheets.get({
            spreadsheetId,
        });
        const sheetNames = (metadata.data.sheets || []).map((s: any) => s.properties?.title || '').filter((n: string) => n);
        console.log(`Found ${sheetNames.length} sheets: ${sheetNames.join(', ')}`);
        return sheetNames;
    } catch (error: any) {
        console.error(`Error getting sheet names for spreadsheet ${spreadsheetId}:`, error.message || error);
        if (error.code === 404) {
            console.error('  → Spreadsheet not found. Check GOOGLE_SHEET_ID and ensure service account has access.');
        }
        // Return empty array but log the error
        return [];
    }
}

async function getSheetDataByPosition(sheets: any, spreadsheetId: string, sheetName: string, maxCols: number = 26): Promise<SheetRow[]> {
    try {
        // Get column letters (A, B, C, ..., Z, AA, AB, ...)
        const getColumnLetter = (col: number): string => {
            let result = '';
            while (col > 0) {
                col--;
                result = String.fromCharCode(65 + (col % 26)) + result;
                col = Math.floor(col / 26);
            }
            return result;
        };
        
        const lastCol = getColumnLetter(maxCols);
        const range = `${sheetName}!A:${lastCol}`;
        
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range,
        });
        
        const rows = response.data.values;
        if (!rows || rows.length < 2) {
            console.log(`  Sheet "${sheetName}" has no data rows`);
            return [];
        }
        
        // First row is headers - we'll use column positions (col_1, col_2, etc.)
        const data: SheetRow[] = [];
        
        for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const rowData: SheetRow = {};
            let hasData = false;
            
            // Map by position: A=col_1, B=col_2, etc.
            for (let j = 0; j < maxCols; j++) {
                const colName = `col_${j + 1}`;
                const value = j < row.length ? (row[j] ? String(row[j]).trim() : '') : '';
                if (value) hasData = true;
                rowData[colName] = value || null;
            }
            
            // Also keep original headers if available for backward compatibility
            if (rows[0]) {
                for (let j = 0; j < Math.min(rows[0].length, row.length); j++) {
                    const header = String(rows[0][j] || '').trim();
                    if (header) {
                        rowData[header] = (row[j] ? String(row[j]).trim() : '') || null;
                    }
                }
            }
            
            if (hasData) {
                data.push(rowData);
            }
        }
        
        return data;
    } catch (error: any) {
        if (error.code === 404) {
            console.log(`  Sheet "${sheetName}" not found (404), trying case-insensitive match...`);
            return [];
        }
        console.error(`Error reading sheet ${sheetName}:`, error.message || error);
        return [];
    }
}

// Helper to find sheet name with case-insensitive matching
function findSheetName(availableSheets: string[], targetName: string): string | null {
    // Exact match first
    if (availableSheets.includes(targetName)) {
        return targetName;
    }
    
    // Case-insensitive match
    const lowerTarget = targetName.toLowerCase();
    for (const sheet of availableSheets) {
        if (sheet.toLowerCase() === lowerTarget) {
            console.log(`  Found case-insensitive match: "${sheet}" for "${targetName}"`);
            return sheet;
        }
    }
    
    // Try variations (underscore vs hyphen, etc.)
    const variations = [
        targetName.replace(/_/g, '-'),
        targetName.replace(/-/g, '_'),
        targetName.replace(/\s+/g, '-'),
        targetName.replace(/\s+/g, '_'),
    ];
    
    for (const variation of variations) {
        if (availableSheets.includes(variation)) {
            console.log(`  Found variation match: "${variation}" for "${targetName}"`);
            return variation;
        }
        // Case-insensitive variation match
        const lowerVariation = variation.toLowerCase();
        for (const sheet of availableSheets) {
            if (sheet.toLowerCase() === lowerVariation) {
                console.log(`  Found case-insensitive variation match: "${sheet}" for "${targetName}"`);
                return sheet;
            }
        }
    }
    
    return null;
}

async function findSpreadsheetId(sheets: any): Promise<string | null> {
    try {
        console.log('Attempting to auto-detect spreadsheet...');
        const drive = google.drive({ version: 'v3', auth: sheets.auth });
        const response = await drive.files.list({
            q: "mimeType='application/vnd.google-apps.spreadsheet'",
            fields: 'files(id, name)',
            pageSize: 50,
        });
        
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

// Generic sync function that maps columns by position
async function syncTableGeneric(conn: any, tableName: string, data: SheetRow[], columnMapping: string[]) {
    const client = await conn.connect();
    try {
        if (data.length === 0) {
            console.log(`  No data to sync for ${tableName}`);
            return;
        }
        
        // Build dynamic INSERT statement based on column mapping
        const columns = columnMapping.map((_, i) => `col_${i + 1}`).join(', ');
        const placeholders = columnMapping.map((_, i) => `$${i + 1}`).join(', ');
        
        // Create table if it doesn't exist with dynamic columns
        await client.query(`
            CREATE TABLE IF NOT EXISTS ${tableName} (
                id SERIAL PRIMARY KEY,
                ${columnMapping.map((col, i) => `col_${i + 1} TEXT`).join(',\n                ')},
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        
        // Insert data
        for (const row of data) {
            const values = columnMapping.map((_, i) => {
                const colName = `col_${i + 1}`;
                return row[colName] || null;
            });
            
            await client.query(`
                INSERT INTO ${tableName} (${columns})
                VALUES (${placeholders})
                ON CONFLICT DO NOTHING
            `, values);
        }
        
        console.log(`✓ Synced ${data.length} rows to ${tableName}`);
    } catch (error) {
        console.error(`❌ Error syncing ${tableName}:`, error);
        throw error;
    } finally {
        client.release();
    }
}

// Position-based sync functions - maps columns A, B, C... to col_1, col_2, col_3...
export async function syncOrders(conn: any, data: SheetRow[]) {
    const client = await conn.connect();
    try {
        for (const row of data) {
            const orderId = row['col_3'] || null; // Column C = Order ID
            if (!orderId) continue;
            
            await client.query(`
                INSERT INTO orders (
                    col_1, col_2, col_3, col_4, col_5, col_6, col_7, col_8,
                    col_9, col_10, col_11, col_12, col_13, col_14, col_15, col_16, order_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
                ON CONFLICT DO NOTHING
            `, [
                row['col_1'] || null, // A
                row['col_2'] || null, // B
                row['col_3'] || null, // C
                row['col_4'] || null, // D
                row['col_5'] || null, // E
                row['col_6'] || null, // F
                row['col_7'] || null, // G
                row['col_8'] || null, // H
                row['col_9'] || null, // I
                row['col_10'] || null, // J
                row['col_11'] || null, // K
                row['col_12'] || null, // L
                row['col_13'] || null, // M
                row['col_14'] || null, // N
                row['col_15'] || null, // O
                row['col_16'] || null, // P
                orderId, // order_id for lookup
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
                    col_1, col_2, col_3, col_4, col_5, col_6, col_7, col_8, tech_id
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                ON CONFLICT DO NOTHING
            `, [
                row['col_1'] || null, // A
                row['col_2'] || null, // B
                row['col_3'] || null, // C
                row['col_4'] || null, // D
                row['col_5'] || null, // E
                row['col_6'] || null, // F
                row['col_7'] || null, // G
                row['col_8'] || null, // H
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
                    col_1, col_2, col_3, col_4, col_5, packer_id
                ) VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT DO NOTHING
            `, [
                row['col_1'] || null, // A
                row['col_2'] || null, // B
                row['col_3'] || null, // C
                row['col_4'] || null, // D
                row['col_5'] || null, // E (if exists)
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
                    col_1, col_2, col_3, col_4
                ) VALUES ($1, $2, $3, $4)
                ON CONFLICT DO NOTHING
            `, [
                row['col_1'] || null, // A
                row['col_2'] || null, // B
                row['col_3'] || null, // C
                row['col_4'] || null, // D
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
                    col_1, col_2, col_3, col_4, col_5, col_6, col_7, col_8, col_9, col_10
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT DO NOTHING
            `, [
                row['col_1'] || null, // A
                row['col_2'] || null, // B
                row['col_3'] || null, // C
                row['col_4'] || null, // D
                row['col_5'] || null, // E
                row['col_6'] || null, // F
                row['col_7'] || null, // G
                row['col_8'] || null, // H
                row['col_9'] || null, // I
                row['col_10'] || null, // J
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
            const sku = row['col_1'] || null; // A
            if (!sku) continue;
            
            await client.query(`
                INSERT INTO sku_stock (
                    col_1, col_2, col_3, col_4, col_5, sku
                ) VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (sku) DO UPDATE SET
                    col_1 = EXCLUDED.col_1,
                    col_2 = EXCLUDED.col_2,
                    col_3 = EXCLUDED.col_3,
                    col_4 = EXCLUDED.col_4,
                    col_5 = EXCLUDED.col_5
            `, [
                row['col_1'] || null, // A
                row['col_2'] || null, // B
                row['col_3'] || null, // C
                row['col_4'] || null, // D
                row['col_5'] || null, // E
                sku, // sku for lookup
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
                    col_1, col_2, col_3, col_4, col_5, col_6, col_7, col_8
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT DO NOTHING
            `, [
                row['col_1'] || null, // A
                row['col_2'] || null, // B
                row['col_3'] || null, // C
                row['col_4'] || null, // D
                row['col_5'] || null, // E
                row['col_6'] || null, // F
                row['col_7'] || null, // G
                row['col_8'] || null, // H
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
        // Get all available sheet names first
        let availableSheets = await getSheetNames(sheets, spreadsheetId);
        
        // If we couldn't get sheet names, try to fetch sheets directly anyway
        // This handles cases where metadata access fails but data access works
        if (availableSheets.length === 0) {
            console.log('  Could not get sheet names from metadata, will try direct access...');
            // Try to get sheet names by attempting to read each expected sheet
            const expectedSheets = ['Orders', 'Tech_1', 'Tech_2', 'Tech_3', 'Receiving', 'Packer_1', 'Packer_2', 'Shipped', 'Sku-Stock', 'Sku'];
            for (const sheetName of expectedSheets) {
                try {
                    const testData = await getSheetDataByPosition(sheets, spreadsheetId, sheetName, 1);
                    if (testData.length >= 0) { // Even empty is valid
                        availableSheets.push(sheetName);
                    }
                } catch (e) {
                    // Sheet doesn't exist or can't be accessed
                }
            }
            if (availableSheets.length > 0) {
                console.log(`  Found ${availableSheets.length} sheets via direct access: ${availableSheets.join(', ')}`);
            }
        }
        
        console.log(`Available sheets: ${availableSheets.length > 0 ? availableSheets.join(', ') : 'none found'}\n`);
        
        // Helper function to try syncing a sheet with case-insensitive matching
        const trySyncSheet = async (
            targetNames: string[],
            syncFn: (conn: any, data: SheetRow[]) => Promise<void>,
            maxCols: number
        ) => {
            for (const targetName of targetNames) {
                // Try exact match first
                let actualSheetName = findSheetName(availableSheets, targetName);
                
                // If not found in available sheets, try direct access (case-insensitive)
                if (!actualSheetName) {
                    // Try the target name directly
                    try {
                        const testData = await getSheetDataByPosition(sheets, spreadsheetId, targetName, maxCols);
                        if (testData.length > 0) {
                            actualSheetName = targetName;
                        }
                    } catch (e) {
                        // Try case variations
                        const variations = [
                            targetName.charAt(0).toUpperCase() + targetName.slice(1).toLowerCase(),
                            targetName.toUpperCase(),
                            targetName.toLowerCase(),
                        ];
                        for (const variation of variations) {
                            try {
                                const testData = await getSheetDataByPosition(sheets, spreadsheetId, variation, maxCols);
                                if (testData.length > 0) {
                                    actualSheetName = variation;
                                    break;
                                }
                            } catch (e2) {
                                continue;
                            }
                        }
                    }
                }
                
                if (actualSheetName) {
                    const data = await getSheetDataByPosition(sheets, spreadsheetId, actualSheetName, maxCols);
                    if (data.length > 0) {
                        await syncFn(conn, data);
                        return true;
                    }
                }
            }
            return false;
        };
        
        // Sync orders - try multiple name variations
        const ordersSynced = await trySyncSheet(['Orders', 'orders', 'ORDERS'], syncOrders, 16);
        if (!ordersSynced) {
            console.log('  Sheet "orders" not found, skipping...');
        }
        
        // Sync tech tables (1-3)
        for (let techNum = 1; techNum <= 3; techNum++) {
            const techSynced = await trySyncSheet(
                [`Tech_${techNum}`, `tech_${techNum}`, `TECH_${techNum}`],
                (conn, data) => syncTechTable(conn, techNum, data),
                8
            );
            if (!techSynced) {
                console.log(`  Sheet "tech_${techNum}" not found, skipping...`);
            }
        }
        
        // Sync packer tables (1-3)
        for (let packerNum = 1; packerNum <= 3; packerNum++) {
            const packerSynced = await trySyncSheet(
                [`Packer_${packerNum}`, `packer_${packerNum}`, `PACKER_${packerNum}`],
                (conn, data) => syncPackerTable(conn, packerNum, data),
                5
            );
            if (!packerSynced) {
                console.log(`  Sheet "Packer_${packerNum}" not found, skipping...`);
            }
        }
        
        // Sync receiving
        const receivingSynced = await trySyncSheet(['Receiving', 'receiving', 'RECEIVING'], syncReceiving, 4);
        if (!receivingSynced) {
            console.log('  Sheet "receiving" not found, skipping...');
        }
        
        // Sync shipped
        const shippedSynced = await trySyncSheet(['Shipped', 'shipped', 'SHIPPED'], syncShipped, 10);
        if (!shippedSynced) {
            console.log('  Sheet "shipped" not found, skipping...');
        }
        
        // Sync sku-stock (try different name variations)
        const skuStockSynced = await trySyncSheet(
            ['Sku-Stock', 'sku-stock', 'SKU-Stock', 'Sku_Stock', 'sku_stock'],
            syncSkuStock,
            5
        );
        if (!skuStockSynced) {
            console.log('  Sheet "Sku-Stock" not found, skipping...');
        }
        
        // Sync sku
        const skuSynced = await trySyncSheet(['Sku', 'sku', 'SKU'], syncSku, 8);
        if (!skuSynced) {
            console.log('  Sheet "sku" not found, skipping...');
        }
        
        console.log('\n✅ All available sheets synced successfully!');
        return { success: true, message: 'All available sheets synced successfully' };
    } catch (error: any) {
        console.error('\n❌ Sync failed:', error);
        throw error;
    }
}
