import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';
import pool from '@/lib/db';

export const maxDuration = 60; // Increase timeout for Vercel

const DEFAULT_SPREADSHEET_ID = '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';

const SHEET_CONFIG = [
    { name: 'Orders', table: 'orders', columnsCount: 14 },
    { name: 'Shipped', table: 'shipped', columnsCount: 14 },
    { name: 'Tech_1', table: 'tech_1', columnsCount: 14 },
    { name: 'Tech_2', table: 'tech_2', columnsCount: 14 },
    { name: 'Tech_3', table: 'tech_3', columnsCount: 14 },
    { name: 'Receiving', table: 'receiving', columnsCount: 14 },
    { name: 'Packer_1', table: 'packer_1', columnsCount: 14 },
    { name: 'Packer_2', table: 'packer_2', columnsCount: 14 },
    { name: 'Sku_Stock', table: 'sku_stock', columnsCount: 14 },
    { name: 'Sku', table: 'sku', columnsCount: 14 },
    { name: 'RS', table: 'rs', columnsCount: 14 },
    // Specialized tables
    { name: 'staff', table: 'staff', columnNames: ['name', 'role', 'employee_id', 'active'] },
    { name: 'tags', table: 'tags', columnNames: ['name', 'color'] },
    { name: 'task_templates', table: 'task_templates', columnNames: ['title', 'description', 'role', 'order_number', 'tracking_number', 'created_by'] },
    { name: 'receiving_tasks', table: 'receiving_tasks', columnNames: ['tracking_number', 'order_number', 'status', 'urgent', 'received_date', 'processed_date', 'notes', 'staff_id'] },
    { name: 'sku_management', table: 'sku_management', columnNames: ['base_sku', 'current_sku_counting'] },
];

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

        // Get all sheet names in the spreadsheet first
        const spreadsheet = await sheets.spreadsheets.get({
            spreadsheetId: targetSpreadsheetId,
        });
        const existingSheetNames = spreadsheet.data.sheets?.map(s => s.properties?.title || '') || [];

        // Build sheets to sync based on hardcoded config, matching case-insensitively
        const sheetsToSync = SHEET_CONFIG.map(config => {
            const actualSheetName = existingSheetNames.find(s => s.toLowerCase() === config.name.toLowerCase());
            if (actualSheetName) {
                return { ...config, name: actualSheetName };
            }
            return null;
        }).filter((s): s is any => s !== null);

        const syncResults = await Promise.all(sheetsToSync.map(async (config) => {
            try {
                const columnNames = config.columnNames || Array.from({ length: config.columnsCount! }, (_, i) => `col_${i + 2}`);
                const dataColumnsCount = columnNames.length;
                
                // Fetch data from Google Sheets - get all columns up to the limit
                const lastColChar = String.fromCharCode(64 + dataColumnsCount);
                const response = await sheets.spreadsheets.values.get({
                    spreadsheetId: targetSpreadsheetId,
                    range: `${config.name}!A2:${lastColChar}`, // Skip header row
                });

                const rows = response.data.values || [];
                
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    
                    // Clear existing data - use TRUNCATE for speed and identity reset
                    await client.query(`TRUNCATE TABLE ${config.table} RESTART IDENTITY CASCADE`);
                    
                    if (rows.length > 0) {
                        const dataRows = rows.filter(row => row.some(cell => cell !== null && cell !== ''));
                        
                        if (dataRows.length > 0) {
                            const CHUNK_SIZE = Math.floor(10000 / dataColumnsCount); 
                            
                            for (let i = 0; i < dataRows.length; i += CHUNK_SIZE) {
                                const chunk = dataRows.slice(i, i + CHUNK_SIZE);
                                
                                const placeholders = chunk.map((_, rowIndex) => 
                                    `(${Array.from({ length: dataColumnsCount }, (_, colIndex) => `$${rowIndex * dataColumnsCount + colIndex + 1}`).join(', ')})`
                                ).join(', ');
                                
                                const values = chunk.flatMap(row => {
                                    const paddedRow = Array(dataColumnsCount).fill(null);
                                    row.forEach((val, index) => {
                                        if (index < dataColumnsCount) {
                                            // Handle boolean/null/empty values
                                            if (val === 'TRUE' || val === 'true') paddedRow[index] = true;
                                            else if (val === 'FALSE' || val === 'false') paddedRow[index] = false;
                                            else if (val === '' || val === undefined || val === null) paddedRow[index] = null;
                                            else paddedRow[index] = String(val);
                                        }
                                    });
                                    return paddedRow;
                                });

                                const columnsList = columnNames.join(', ');
                                const query = `INSERT INTO ${config.table} (${columnsList}) VALUES ${placeholders}`;
                                
                                await client.query(query, values);
                            }
                        }
                    }
                    
                    await client.query('COMMIT');
                    return { sheet: config.name, table: config.table, status: 'success', rows: rows.length };
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

        return NextResponse.json({ 
            success: true, 
            message: 'Sync process completed',
            results: syncResults,
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
