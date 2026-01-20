import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const sku = searchParams.get('sku');

        if (!sku) {
            return NextResponse.json({ error: 'Missing sku query param' }, { status: 400 });
        }

        const auth = getGoogleAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        
        const spreadsheetId = '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';
        const range = "'Sku-Stock'!A:D";

        const { data } = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range,
            majorDimension: 'ROWS',
        });

        const rows = data.values || [];
        const normalizedInputSku = String(sku).trim().replace(/^0+/, '') || '0';

        for (const row of rows) {
            const stock = row[0]; // Column A
            const rowSku = row[1]; // Column B
            const location = row[2]; // Column C
            const title = row[3]; // Column D

            if (rowSku) {
                const normalizedRowSku = String(rowSku).trim().replace(/^0+/, '') || '0';
                if (normalizedRowSku === normalizedInputSku) {
                    return NextResponse.json({
                        sku,
                        title: title || '',
                        stock: stock ? String(stock).trim() : '0',
                        location: location || ''
                    });
                }
            }
        }

        return NextResponse.json({ sku, title: '', stock: '0', location: '' });
    } catch (error: any) {
        console.error('API error', error);
        return NextResponse.json({ error: 'Internal Server Error', details: error.message }, { status: 500 });
    }
}

