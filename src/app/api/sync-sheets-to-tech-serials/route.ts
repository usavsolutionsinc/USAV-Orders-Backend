import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';
import pool from '@/lib/db';

export const maxDuration = 60;

const DEFAULT_SPREADSHEET_ID = '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';

/**
 * Sync tech sheet data (test_date_time and tester_id) to tech_serial_numbers table
 * This replaces the old sync logic that updated orders.test_date_time and orders.tested_by
 */
export async function POST(req: NextRequest) {
    try {
        const body = await req.json().catch(() => ({}));
        const targetSpreadsheetId = body.spreadsheetId || process.env.SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;

        const auth = getGoogleAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        const techSheets = ['tech_1', 'tech_2', 'tech_3', 'tech_4'];
        
        const techEmployeeIds: { [key: string]: string } = {
            'tech_1': 'TECH001',
            'tech_2': 'TECH002',
            'tech_3': 'TECH003',
            'tech_4': 'TECH004'
        };

        const results = [];
        const client = await pool.connect();

        try {
            for (const sheetName of techSheets) {
                try {
                    const response = await sheets.spreadsheets.values.get({
                        spreadsheetId: targetSpreadsheetId,
                        range: `${sheetName}!A2:D`, // A=date_time, C=tracking, D=serial
                    });

                    const rows = response.data.values || [];
                    const employeeId = techEmployeeIds[sheetName];
                    
                    // Get staff ID and name
                    const staffResult = await client.query(
                        'SELECT id, name FROM staff WHERE employee_id = $1',
                        [employeeId]
                    );
                    
                    if (staffResult.rows.length === 0) {
                        results.push({
                            sheet: sheetName,
                            status: 'error',
                            error: `Staff not found for employee_id: ${employeeId}`
                        });
                        continue;
                    }
                    
                    const staffId = staffResult.rows[0].id;
                    const staffName = staffResult.rows[0].name;

                    let updatedCount = 0;
                    let insertedCount = 0;
                    let skippedCount = 0;

                    for (const row of rows) {
                        const dateTime = row[0] || ''; // Column A
                        const tracking = row[2] || ''; // Column C
                        const serial = row[3] || ''; // Column D

                        if (!tracking || !serial || !dateTime) {
                            skippedCount++;
                            continue;
                        }

                        const upperSerial = serial.toUpperCase();

                        // Convert dateTime to timestamp if needed
                        let parsedDateTime;
                        try {
                            if (dateTime.includes('/')) {
                                const [datePart, timePart] = dateTime.split(' ');
                                const [m, d, y] = datePart.split('/');
                                parsedDateTime = new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${timePart || '00:00:00'}`);
                            } else {
                                parsedDateTime = new Date(dateTime);
                            }
                        } catch (e) {
                            console.error(`Failed to parse dateTime: ${dateTime}`);
                            skippedCount++;
                            continue;
                        }

                        // Determine serial type
                        let serialType = 'SERIAL';
                        if (/^X0|^B0/i.test(upperSerial)) {
                            serialType = 'FNSKU';
                        }

                        // Check if this serial already exists for this tracking number
                        const existingSerial = await client.query(
                            `SELECT id, test_date_time, tester_id FROM tech_serial_numbers 
                             WHERE shipping_tracking_number = $1 AND serial_number = $2`,
                            [tracking, upperSerial]
                        );

                        if (existingSerial.rows.length > 0) {
                            // Update existing record with sheet data
                            await client.query(
                                `UPDATE tech_serial_numbers
                                 SET test_date_time = $1,
                                     tester_id = $2
                                 WHERE shipping_tracking_number = $3 AND serial_number = $4`,
                                [parsedDateTime, staffId, tracking, upperSerial]
                            );
                            updatedCount++;
                        } else {
                            // Insert new serial from sheet
                            await client.query(
                                `INSERT INTO tech_serial_numbers 
                                 (shipping_tracking_number, serial_number, serial_type, test_date_time, tester_id)
                                 VALUES ($1, $2, $3, $4, $5)`,
                                [tracking, upperSerial, serialType, parsedDateTime, staffId]
                            );
                            insertedCount++;
                        }
                    }

                    results.push({
                        sheet: sheetName,
                        techName: staffName,
                        status: 'synced',
                        updated: updatedCount,
                        inserted: insertedCount,
                        skipped: skippedCount,
                        total: updatedCount + insertedCount
                    });

                } catch (err) {
                    console.error(`Error syncing tech sheet ${sheetName}:`, err);
                    results.push({
                        sheet: sheetName,
                        status: 'error',
                        error: err instanceof Error ? err.message : String(err)
                    });
                }
            }

            return NextResponse.json({
                success: true,
                message: 'Tech sheets synced to tech_serial_numbers table',
                results,
                timestamp: new Date().toISOString()
            });

        } finally {
            client.release();
        }

    } catch (error: any) {
        console.error('Sync error:', error);
        return NextResponse.json({
            success: false,
            error: 'Internal Server Error',
            details: error.message
        }, { status: 500 });
    }
}
