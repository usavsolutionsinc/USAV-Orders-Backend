import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';

async function findEmptyRow(sheets: any, spreadsheetId: string, range: string) {
    const { data } = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range,
        majorDimension: 'ROWS',
    });

    const rows = data.values || [];
    for (let i = 0; i < rows.length; i++) {
        if (!rows[i] || !rows[i][0] || rows[i][0].trim() === '') {
            return i + 1;
        }
    }
    return rows.length + 1;
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { sku, serialNumbers, notes, productTitle, size, location } = body;

        if (!sku || !serialNumbers || !Array.isArray(serialNumbers) || serialNumbers.length === 0) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }

        const auth = getGoogleAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';
        const range = "'Sku'!A:H";

        const rowIndex = await findEmptyRow(sheets, spreadsheetId, range);
        const now = new Date();
        const timestamp = now.toLocaleString('en-US', { timeZone: 'America/New_York' });

        const values = [[timestamp, sku, serialNumbers.join(', '), '', productTitle || '', size || '', notes || '', location || '']];

        await sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `'Sku'!A${rowIndex}:H${rowIndex}`,
            valueInputOption: 'RAW',
            requestBody: { values },
        });

        return NextResponse.json({ success: true, row: rowIndex });
    } catch (error: any) {
        console.error('Post error:', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}

