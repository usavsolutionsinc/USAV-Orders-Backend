import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';
import pool from '@/lib/db';

export const maxDuration = 60; // Increase timeout for Vercel

const DEFAULT_SPREADSHEET_ID = '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { action, spreadsheetId } = body;

        if (action !== 'sync_all') {
            return NextResponse.json({ error: 'Invalid action. Only sync_all is supported.' }, { status: 400 });
        }

        const targetSpreadsheetId = spreadsheetId || process.env.SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;

        const auth = getGoogleAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        // 1. Get all sheet names from Google Sheets
        const spreadsheet = await sheets.spreadsheets.get({
            spreadsheetId: targetSpreadsheetId,
        });
        const existingSheetNames = spreadsheet.data.sheets?.map(s => s.properties?.title || '') || [];

        // Tech and packer sheets update orders table directly
        const techSheets = ['tech_1', 'tech_2', 'tech_3', 'tech_4'];
        const packerSheets = ['packer_1', 'packer_2', 'packer_3'];
        const shippedSheet = 'shipped';

        const techEmployeeIds: { [key: string]: string } = {
            'tech_1': 'TECH001',
            'tech_2': 'TECH002',
            'tech_3': 'TECH003'
        };

        const packerEmployeeIds: { [key: string]: string } = {
            'packer_1': 'PACK001',
            'packer_2': 'PACK002'
        };

        // 2. Get all tables and their columns from Neon DB
        const client = await pool.connect();
        let tablesInfo: any[] = [];
        try {
            const tablesResult = await client.query(`
                SELECT 
                    t.table_name, 
                    array_agg(c.column_name ORDER BY c.ordinal_position) as columns
                FROM 
                    information_schema.tables t
                JOIN 
                    information_schema.columns c ON t.table_name = c.table_name
                WHERE 
                    t.table_schema = 'public'
                    AND t.table_type = 'BASE TABLE'
                GROUP BY 
                    t.table_name
            `);
            tablesInfo = tablesResult.rows;
        } finally {
            client.release();
        }

        // 3. Match sheets to tables dynamically
        // EXCLUDE tech/packer/shipped tables and repair_service - they update orders table
        // EXCLUDE orders table - it's NOT synced from the orders sheet
        const excludedTables = [
            'tech_1', 'tech_2', 'tech_3', 'tech_4',
            'packer_1', 'packer_2', 'packer_3',
            'shipped',
            'orders',  // Orders sheet does NOT sync to orders table
            'repair_service'
        ];

        const sheetsToSync = existingSheetNames.map(sheetName => {
            const matchingTable = tablesInfo.find(t => t.table_name.toLowerCase() === sheetName.toLowerCase());
            if (matchingTable) {
                // Skip excluded tables (tech and repair_service only)
                if (excludedTables.includes(matchingTable.table_name.toLowerCase())) {
                    return null;
                }

                // Handle both array and PostgreSQL array string formats
                let columns: string[] = [];
                if (Array.isArray(matchingTable.columns)) {
                    columns = matchingTable.columns;
                } else if (typeof matchingTable.columns === 'string') {
                    // Remove braces and split by comma
                    columns = matchingTable.columns.replace(/^{|}$/g, '').split(',').map((c: string) => c.trim().replace(/^"|"$/g, ''));
                }

                if (columns.length === 0) return null;

                // Filter out primary keys and auto-generated columns
                let columnNames = columns.filter((col: string) => 
                    !['col_1', 'id', 'created_at', 'updated_at'].includes(col.toLowerCase())
                );
                
                return {
                    name: sheetName,
                    table: matchingTable.table_name,
                    columnNames: columnNames
                };
            }
            return null;
        }).filter((s): s is any => s !== null);

        if (sheetsToSync.length === 0 && !existingSheetNames.some(s => techSheets.includes(s.toLowerCase()) || packerSheets.includes(s.toLowerCase()))) {
            return NextResponse.json({ 
                success: true, 
                message: 'No matching sheets and tables found to sync.',
                results: [] 
            });
        }

        // Sync tech, packer, and shipped sheets to orders table
        const techPackerResults = [];

        for (const sheetName of existingSheetNames) {
            const lowerName = sheetName.toLowerCase();
            
            // Handle Shipped Sheet - sync entire sheet to orders table
            if (lowerName === shippedSheet) {
                try {
                    const response = await sheets.spreadsheets.values.get({
                        spreadsheetId: targetSpreadsheetId,
                        range: `${sheetName}!A2:J`, // A-J columns
                    });

                    const rows = response.data.values || [];
                    const client = await pool.connect();
                    let updatedCount = 0;
                    let insertedCount = 0;

                    try {
                        // Staff name to ID mappings
                        const packerNameMap: { [key: string]: number } = {
                            'Tuan': 4,
                            'Thuy': 5
                        };
                        
                        const techNameMap: { [key: string]: number } = {
                            'Mike': 1,
                            'Michael': 1,
                            'Thuc': 2,
                            'Sang': 3
                        };

                        for (const row of rows) {
                            const packDateTime = row[0] || ''; // Column A
                            const orderId = row[1] || ''; // Column B
                            const productTitle = row[2] || ''; // Column C
                            const quantity = row[3] || ''; // Column D
                            const condition = row[4] || ''; // Column E
                            const shippingTracking = row[5] || ''; // Column F
                            const serialNumber = row[6] || ''; // Column G
                            const packerName = row[7] || ''; // Column H
                            const techName = row[8] || ''; // Column I
                            const sku = row[9] || ''; // Column J

                            if (!shippingTracking) continue; // Skip if no tracking number

                            // Map names to staff IDs
                            const packedBy = packerName ? (packerNameMap[packerName] || null) : null;
                            const testedBy = techName ? (techNameMap[techName] || 6) : 6; // Default to 6 (Cuong) if empty or unknown

                            // Convert dateTime to ISO format for status_history if needed
                            let isoPackTimestamp = packDateTime;
                            try {
                                if (packDateTime && packDateTime.includes('/')) {
                                    const [datePart, timePart] = packDateTime.split(' ');
                                    const [m, d, y] = datePart.split('/');
                                    isoPackTimestamp = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${timePart || '00:00:00'}`).toISOString();
                                }
                            } catch (e) {
                                // Keep original if conversion fails
                            }

                            // Check if order exists
                            const existingOrder = await client.query(
                                'SELECT id, status_history FROM orders WHERE shipping_tracking_number = $1',
                                [shippingTracking]
                            );

                            if (existingOrder.rows.length > 0) {
                                // Update existing order
                                const statusHistory = existingOrder.rows[0].status_history || [];
                                let newStatusHistory = statusHistory;

                                // Add packed status to history if packed_by is set
                                if (packedBy && packDateTime) {
                                    const packerStaffName = Object.keys(packerNameMap).find(key => packerNameMap[key] === packedBy) || 'Unknown';
                                    newStatusHistory = [...statusHistory, {
                                        status: 'packed',
                                        timestamp: isoPackTimestamp,
                                        user: packerStaffName,
                                        previous_status: statusHistory.length > 0 ? statusHistory[statusHistory.length - 1].status : null
                                    }];
                                }

                                await client.query(`
                                    UPDATE orders
                                    SET 
                                        order_id = COALESCE(NULLIF($1, ''), order_id),
                                        product_title = COALESCE(NULLIF($2, ''), product_title),
                                        condition = COALESCE(NULLIF($3, ''), condition),
                                        serial_number = COALESCE(NULLIF($4, ''), serial_number),
                                        sku = COALESCE(NULLIF($5, ''), sku),
                                        packed_by = COALESCE($6, packed_by),
                                        tested_by = COALESCE($7, tested_by),
                                        pack_date_time = COALESCE(NULLIF($8, ''), pack_date_time),
                                        is_shipped = CASE WHEN $8 != '' THEN true ELSE is_shipped END,
                                        status_history = $9::jsonb
                                    WHERE shipping_tracking_number = $10
                                `, [orderId, productTitle, condition, serialNumber, sku, packedBy, testedBy, packDateTime, JSON.stringify(newStatusHistory), shippingTracking]);
                                updatedCount++;
                            } else {
                                // Insert new order
                                const statusHistory = [];
                                if (packedBy && packDateTime) {
                                    const packerStaffName = Object.keys(packerNameMap).find(key => packerNameMap[key] === packedBy) || 'Unknown';
                                    statusHistory.push({
                                        status: 'packed',
                                        timestamp: isoPackTimestamp,
                                        user: packerStaffName,
                                        previous_status: null
                                    });
                                }

                                await client.query(`
                                    INSERT INTO orders (
                                        order_id, product_title, condition, shipping_tracking_number,
                                        serial_number, sku, packed_by, tested_by, pack_date_time,
                                        is_shipped, status, status_history
                                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
                                `, [orderId, productTitle, condition, shippingTracking, serialNumber, sku, 
                                    packedBy, testedBy, packDateTime, packDateTime ? true : false, 
                                    'shipped', JSON.stringify(statusHistory)]);
                                insertedCount++;
                            }
                        }
                        
                        techPackerResults.push({ 
                            sheet: sheetName, 
                            table: 'orders (shipped)', 
                            status: 'synced', 
                            updated: updatedCount,
                            inserted: insertedCount,
                            total: updatedCount + insertedCount
                        });
                    } finally {
                        client.release();
                    }
                } catch (err) {
                    console.error(`Error syncing shipped sheet ${sheetName}:`, err);
                    techPackerResults.push({ 
                        sheet: sheetName, 
                        table: 'orders (shipped)', 
                        status: 'error', 
                        error: err instanceof Error ? err.message : String(err) 
                    });
                }
            }
            
            
            // Handle Tech Sheets
            if (techSheets.includes(lowerName)) {
                try {
                    const response = await sheets.spreadsheets.values.get({
                        spreadsheetId: targetSpreadsheetId,
                        range: `${sheetName}!A2:D`, // A=date_time, C=tracking, D=serial
                    });

                    const rows = response.data.values || [];
                    const employeeId = techEmployeeIds[lowerName];
                    const client = await pool.connect();
                    let updatedCount = 0;

                    try {
                        // Get staff ID and name
                        const staffResult = await client.query(
                            'SELECT id, name FROM staff WHERE employee_id = $1',
                            [employeeId]
                        );
                        
                        if (staffResult.rows.length === 0) {
                            throw new Error(`Staff not found for employee_id: ${employeeId}`);
                        }
                        
                        const staffId = staffResult.rows[0].id;
                        const staffName = staffResult.rows[0].name;

                        for (const row of rows) {
                            const dateTime = row[0] || ''; // Column A
                            const tracking = row[2] || ''; // Column C
                            const serial = row[3] || ''; // Column D

                            if (tracking && serial && dateTime) {
                                // Convert dateTime to ISO format for status_history
                                let isoTimestamp = dateTime;
                                try {
                                    if (dateTime.includes('/')) {
                                        const [datePart, timePart] = dateTime.split(' ');
                                        const [m, d, y] = datePart.split('/');
                                        isoTimestamp = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${timePart || '00:00:00'}`).toISOString();
                                    }
                                } catch (e) {
                                    // Keep original if conversion fails
                                }

                                await client.query(`
                                    UPDATE orders
                                    SET serial_number = $1,
                                        tested_by = $2,
                                        test_date_time = $3,
                                        status_history = COALESCE(status_history, '[]'::jsonb) || 
                                            jsonb_build_object(
                                                'status', 'tested',
                                                'time', $4::text,
                                                'user', $5::text,
                                                'previous_status', status_history->-1->>'status'
                                            )::jsonb
                                    WHERE shipping_tracking_number = $6
                                `, [serial, staffId, dateTime, isoTimestamp, staffName, tracking]);
                                updatedCount++;
                            }
                        }
                        
                        techPackerResults.push({ 
                            sheet: sheetName, 
                            table: 'orders (tech)', 
                            status: 'updated', 
                            rows: updatedCount 
                        });
                    } finally {
                        client.release();
                    }
                } catch (err) {
                    console.error(`Error syncing tech sheet ${sheetName}:`, err);
                    techPackerResults.push({ 
                        sheet: sheetName, 
                        table: 'orders (tech)', 
                        status: 'error', 
                        error: err instanceof Error ? err.message : String(err) 
                    });
                }
            }
            
            // Handle Packer Sheets
            if (packerSheets.includes(lowerName)) {
                try {
                    const response = await sheets.spreadsheets.values.get({
                        spreadsheetId: targetSpreadsheetId,
                        range: `${sheetName}!A2:B`, // A=date_time, B=tracking
                    });

                    const rows = response.data.values || [];
                    const employeeId = packerEmployeeIds[lowerName];
                    const client = await pool.connect();
                    let updatedCount = 0;

                    try {
                        // Get staff ID and name
                        const staffResult = await client.query(
                            'SELECT id, name FROM staff WHERE employee_id = $1',
                            [employeeId]
                        );
                        
                        if (staffResult.rows.length === 0) {
                            throw new Error(`Staff not found for employee_id: ${employeeId}`);
                        }
                        
                        const staffId = staffResult.rows[0].id;
                        const staffName = staffResult.rows[0].name;

                        for (const row of rows) {
                            const dateTime = row[0] || ''; // Column A
                            const tracking = row[1] || ''; // Column B

                            if (tracking && dateTime) {
                                // Convert dateTime to ISO format for status_history
                                let isoTimestamp = dateTime;
                                try {
                                    if (dateTime.includes('/')) {
                                        const [datePart, timePart] = dateTime.split(' ');
                                        const [m, d, y] = datePart.split('/');
                                        isoTimestamp = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${timePart || '00:00:00'}`).toISOString();
                                    }
                                } catch (e) {
                                    // Keep original if conversion fails
                                }

                                await client.query(`
                                    UPDATE orders
                                    SET packed_by = $1,
                                        pack_date_time = $2,
                                        is_shipped = true,
                                        status_history = COALESCE(status_history, '[]'::jsonb) || 
                                            jsonb_build_object(
                                                'status', 'packed',
                                                'time', $4::text,
                                                'user', $5::text,
                                                'previous_status', status_history->-1->>'status'
                                            )::jsonb
                                    WHERE shipping_tracking_number = $3
                                `, [staffId, dateTime, tracking, isoTimestamp, staffName]);
                                updatedCount++;
                            }
                        }
                        
                        techPackerResults.push({ 
                            sheet: sheetName, 
                            table: 'orders (packer)', 
                            status: 'updated', 
                            rows: updatedCount 
                        });
                    } finally {
                        client.release();
                    }
                } catch (err) {
                    console.error(`Error syncing packer sheet ${sheetName}:`, err);
                    techPackerResults.push({ 
                        sheet: sheetName, 
                        table: 'orders (packer)', 
                        status: 'error', 
                        error: err instanceof Error ? err.message : String(err) 
                    });
                }
            }
        }

        // Continue with normal table sync for other sheets
        const syncResults = await Promise.all(sheetsToSync.map(async (config) => {
            try {
                const columnNames = config.columnNames;
                const dataColumnsCount = columnNames.length;
                
                // Fetch data from Google Sheets - get all columns up to the limit
                // Convert column count to A1 notation (e.g., 1 -> A, 2 -> B, ..., 26 -> Z, 27 -> AA)
                const getColumnLetter = (n: number) => {
                    let letter = '';
                    while (n > 0) {
                        let temp = (n - 1) % 26;
                        letter = String.fromCharCode(65 + temp) + letter;
                        n = (n - temp - 1) / 26;
                    }
                    return letter;
                };
                
                const lastColChar = getColumnLetter(dataColumnsCount);
                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId: targetSpreadsheetId,
                    range: `${config.name}!A2:${lastColChar}`, // Skip header row
                });

                const rows = response.data.values || [];
                
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    
                    // Wipe everything first
                    await client.query(`DELETE FROM ${config.table}`);
                    
                    // Restart identity if it's a generic table with col_1 or specialized with id
                    const hasCol1 = columnNames.length > 0 && !columnNames.includes('col_1');
                    const hasId = columnNames.length > 0 && !columnNames.includes('id');
                    
                    if (hasCol1) {
                        await client.query(`ALTER SEQUENCE IF EXISTS ${config.table}_col_1_seq RESTART WITH 1`);
                    }
                    if (hasId) {
                        await client.query(`ALTER SEQUENCE IF EXISTS ${config.table}_id_seq RESTART WITH 1`);
                    }
                    
                    if (rows.length > 0) {
                        const dataRows = rows.filter(row => row.some(cell => cell !== null && cell !== ''));
                        
                        if (dataRows.length > 0) {
                            const CHUNK_SIZE = 500;
                            
                            for (let i = 0; i < dataRows.length; i += CHUNK_SIZE) {
                                const chunk = dataRows.slice(i, i + CHUNK_SIZE);
                                
                                const placeholders = chunk.map((_, rowIndex) => 
                                    `(${Array.from({ length: dataColumnsCount }, (_, colIndex) => `$${rowIndex * dataColumnsCount + colIndex + 1}`).join(', ')})`
                                ).join(', ');
                                
                                const values = chunk.flatMap(row => {
                                    const paddedRow = Array(dataColumnsCount).fill(null);
                                    row.forEach((val, index) => {
                                        if (index < dataColumnsCount) {
                                            if (val === '' || val === undefined || val === null) paddedRow[index] = null;
                                            else paddedRow[index] = String(val);
                                        }
                                    });
                                    return paddedRow;
                                });

                                // Quote column names to handle spaces and special characters
                                const columnsList = columnNames.map((col: string) => `"${col}"`).join(', ');
                                const query = `INSERT INTO ${config.table} (${columnsList}) VALUES ${placeholders}`;
                                
                                await client.query(query, values);
                            }
                        }
                    }
                    
                    await client.query('COMMIT');
                    return { sheet: config.name, table: config.table, status: 'replaced', rows: rows.length };
                } catch (dbErr) {
                    await client.query('ROLLBACK');
                    throw dbErr;
                } finally {
                    client.release();
                }
            } catch (err) {
                console.error(`Error syncing sheet ${config.name} to table ${config.table}:`, err);
                return { sheet: config.name, table: config.table, status: 'error', error: err instanceof Error ? err.message : String(err) };
            }
        }));

        // Combine results
        const allResults = [...techPackerResults, ...syncResults];

        return NextResponse.json({ 
            success: true, 
            message: 'Sync process completed',
            results: allResults,
            timestamp: new Date().toISOString()
        });

    } catch (error: any) {
        console.error('Sync error:', error);
        return NextResponse.json({ 
            success: false,
            error: 'Internal Server Error', 
            details: error.message 
        }, { status: 500 });
    }
}
