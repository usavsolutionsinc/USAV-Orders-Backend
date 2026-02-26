import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';
import pool from '@/lib/db';
import { normalizeSku } from '@/utils/sku';
import { formatPSTTimestamp } from '@/lib/timezone';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { sku, location } = body;

        if (!sku || location === undefined) {
            return NextResponse.json({ error: 'Missing sku or location' }, { status: 400 });
        }

        const auth = getGoogleAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';
        const range = "'Sku-Stock'!A:D";

        // 1. Update Google Sheets (Sku-Stock sheet)
        const { data } = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range,
            majorDimension: 'ROWS',
        });

        const rows = data.values || [];
        const normalizedInputSku = normalizeSku(sku);
        let rowIndex = -1;

        for (let i = 0; i < rows.length; i++) {
            const rowSku = rows[i][1]; // Column B
            if (rowSku && normalizeSku(rowSku) === normalizedInputSku) {
                rowIndex = i + 1; // 1-based index
                break;
            }
        }

        if (rowIndex !== -1) {
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `'Sku-Stock'!C${rowIndex}`, // Column C is Location
                valueInputOption: 'RAW',
                requestBody: { values: [[location]] },
            });
        }

        // 2. Also log this location change in the 'sku' database table
        // This creates a history of where this SKU has been
        const timestamp = formatPSTTimestamp(new Date());
        try {
            await pool.query(
                `INSERT INTO sku (date_time, static_sku, location, notes)
                 VALUES ($1, $2, $3, $4)`,
                [timestamp, sku, location, 'Location updated via Change Location mode']
            );
        } catch (dbError) {
            console.error('Database update error:', dbError);
        }

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error('Update location error:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}
