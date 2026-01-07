import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';
import pool from '@/lib/db';

export const maxDuration = 60; // Increase timeout for Vercel

const DEFAULT_SPREADSHEET_ID = '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';

const SHEET_CONFIG = [
    { name: 'orders', table: 'orders', columns: 10 },
    { name: 'tech_1', table: 'tech_1', columns: 7 },
    { name: 'tech_2', table: 'tech_2', columns: 7 },
    { name: 'tech_3', table: 'tech_3', columns: 7 },
    { name: 'tech_4', table: 'tech_4', columns: 7 },
    { name: 'Packer_1', table: 'packer_1', columns: 5 },
    { name: 'Packer_2', table: 'packer_2', columns: 5 },
    { name: 'Packer_3', table: 'packer_3', columns: 5 },
    { name: 'receiving', table: 'receiving', columns: 5 },
    { name: 'shipped', table: 'shipped', columns: 10 },
    { name: 'sku-stock', table: 'sku_stock', columns: 5 },
    { name: 'Sku-Stock', table: 'sku_stock', columns: 5 },
    { name: 'sku', table: 'sku', columns: 8 },
    { name: 'Sku', table: 'sku', columns: 8 },
    { name: 'rs', table: 'rs', columns: 10 },
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

        // Get all sheet names in the spreadsheet first to avoid 404s on specific sheets
        const spreadsheet = await sheets.spreadsheets.get({
            spreadsheetId: targetSpreadsheetId,
        });
        const existingSheetNames = new Set(spreadsheet.data.sheets?.map(s => s.properties?.title) || []);

        // Group configs by table to avoid double-syncing if both 'sku-stock' and 'Sku-Stock' exist
        const tableToSheetMap = new Map<string, string>();
        for (const config of SHEET_CONFIG) {
            if (existingSheetNames.has(config.name) && !tableToSheetMap.has(config.table)) {
                tableToSheetMap.set(config.table, config.name);
            }
        }

        const sheetsToSync = SHEET_CONFIG.filter(config => 
            existingSheetNames.has(config.name) && tableToSheetMap.get(config.table) === config.name
        );

        const syncResults = await Promise.all(sheetsToSync.map(async (config) => {
            try {
                // Determine number of data columns (table total columns - 1 for the SERIAL col_1)
                const dataColumnsCount = config.columns - 1;
                
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
                    
                    // Clear existing data
                    await client.query(`TRUNCATE TABLE ${config.table} RESTART IDENTITY`);
                    
                    if (rows.length > 0) {
                        // Filter out completely empty rows
                        const dataRows = rows.filter(row => row.some(cell => cell !== null && cell !== ''));
                        
                        if (dataRows.length > 0) {
                            // Postgres has a parameter limit (65535). 
                            // We'll chunk the inserts to stay safe.
                            const CHUNK_SIZE = Math.floor(10000 / dataColumnsCount); 
                            
                            for (let i = 0; i < dataRows.length; i += CHUNK_SIZE) {
                                const chunk = dataRows.slice(i, i + CHUNK_SIZE);
                                
                                const placeholders = chunk.map((_, rowIndex) => 
                                    `(${Array.from({ length: dataColumnsCount }, (_, colIndex) => `$${rowIndex * dataColumnsCount + colIndex + 1}`).join(', ')})`
                                ).join(', ');
                                
                                const values = chunk.flatMap(row => {
                                    const paddedRow = Array(dataColumnsCount).fill('');
                                    row.forEach((val, index) => {
                                        if (index < dataColumnsCount) paddedRow[index] = val !== undefined && val !== null ? String(val) : '';
                                    });
                                    return paddedRow;
                                });

                                const columnsList = Array.from({ length: dataColumnsCount }, (_, index) => `col_${index + 2}`).join(', ');
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
