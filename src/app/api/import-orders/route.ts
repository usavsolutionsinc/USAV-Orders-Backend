import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { data } = body;

        if (!data || !Array.isArray(data)) {
            return NextResponse.json({ error: 'Invalid data format' }, { status: 400 });
        }

        const auth = getGoogleAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';
        const sheetName = 'Orders';

        // Prepare the values in the requested order:
        // A - Ship by date, B - Order Number, C - Item title, D - Quantity, 
        // E - USAV SKU, F - Condition, G - Tracking, J - Note
        // Note: H and I are empty
        const rowsToAppend = data.map((item: any) => [
            item.shipByDate,   // A
            item.orderNumber,  // B
            item.itemTitle,    // C
            item.quantity,     // D
            item.usavSku,      // E
            item.condition,    // F
            item.tracking,     // G
            '',                // H (Empty)
            '',                // I (Empty)
            item.note          // J
        ]);

        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: `${sheetName}!A:J`,
            valueInputOption: 'RAW',
            requestBody: {
                values: rowsToAppend,
            },
        });

        return NextResponse.json({ 
            success: true, 
            message: `Successfully imported ${data.length} orders.` 
        });
    } catch (error: any) {
        console.error('Import error:', error);
        return NextResponse.json({ 
            error: 'Internal Server Error', 
            details: error.message 
        }, { status: 500 });
    }
}
