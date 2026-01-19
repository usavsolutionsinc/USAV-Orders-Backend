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
        const sheetsToSync = existingSheetNames.map(sheetName => {
            const matchingTable = tablesInfo.find(t => t.table_name.toLowerCase() === sheetName.toLowerCase());
            if (matchingTable) {
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
                const columnNames = columns.filter((col: string) => 
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

        if (sheetsToSync.length === 0) {
            return NextResponse.json({ 
                success: true, 
                message: 'No matching sheets and tables found to sync.',
                results: [] 
            });
        }

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
                                const columnsList = columnNames.map(col => `"${col}"`).join(', ');
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
