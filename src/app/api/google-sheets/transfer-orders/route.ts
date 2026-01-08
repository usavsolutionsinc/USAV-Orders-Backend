import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { getGoogleAuth } from '@/lib/google-auth';

const SOURCE_SPREADSHEET_ID = '1b8uvgk4q7jJPjGvFM2TQs3vMES1o9MiAfbEJ7P1TW9w';
const DEST_SPREADSHEET_ID = '1fM9t4iw_6UeGfNbKZaKA7puEFfWqOiNtITGDVSgApCE';
const DEST_SHEET_NAME = 'orders';

export async function POST(req: NextRequest) {
    try {
        const auth = getGoogleAuth();
        const sheets = google.sheets({ version: 'v4', auth });

        // 1. Find the most relevant sheet tab
        const sourceSpreadsheet = await sheets.spreadsheets.get({
            spreadsheetId: SOURCE_SPREADSHEET_ID,
        });

        const sheetTabs = sourceSpreadsheet.data.sheets || [];
        const dateTabs = sheetTabs
            .map(s => s.properties?.title || '')
            .filter(title => title.startsWith('Sheet_'))
            .map(title => {
                // Format: Sheet_MM_DD_YYYY
                const parts = title.split('_');
                if (parts.length < 4) return { title, date: new Date(0) };
                const mm = parseInt(parts[1]);
                const dd = parseInt(parts[2]);
                const yyyy = parseInt(parts[3]);
                return { title, date: new Date(yyyy, mm - 1, dd) };
            })
            .sort((a, b) => b.date.getTime() - a.date.getTime());

        if (dateTabs.length === 0) {
            return NextResponse.json({ success: false, error: 'No valid sheet tabs found in source' }, { status: 404 });
        }

        const targetTabName = dateTabs[0].title;

        // 2. Read the Shipped sheet for existing tracking numbers to deduplicate
        const shippedTrackingResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: DEST_SPREADSHEET_ID,
            range: `shipped!E2:E`, // Column E is tracking in Shipped sheet
        });

        const existingTrackingInShipped = new Set(
            (shippedTrackingResponse.data.values || [])
                .flat()
                .filter(t => t && t.trim() !== '')
                .map(t => String(t).trim())
        );

        // 3. Read the source tab from Master Sheet
        const sourceDataResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: SOURCE_SPREADSHEET_ID,
            range: `${targetTabName}!A1:Z`,
        });

        const sourceRows = sourceDataResponse.data.values || [];
        if (sourceRows.length < 2) {
            return NextResponse.json({ success: false, error: 'No data found in source tab' }, { status: 404 });
        }

        const headerRow = sourceRows[0];
        const colIndices = {
            shipByDate: headerRow.indexOf('Ship by date'),
            orderNumber: headerRow.indexOf('Order Number'),
            itemTitle: headerRow.indexOf('Item title'),
            quantity: headerRow.indexOf('Quantity'),
            usavSku: headerRow.indexOf('USAV SKU'),
            condition: headerRow.indexOf('Condition'),
            tracking: headerRow.indexOf('Tracking'),
            note: headerRow.indexOf('Note'),
        };

        // Validate required columns
        const missingCols = Object.entries(colIndices)
            .filter(([_, index]) => index === -1)
            .map(([name]) => name);

        if (missingCols.length > 0) {
            return NextResponse.json({ 
                success: false, 
                error: `Missing columns in source: ${missingCols.join(', ')}` 
            }, { status: 400 });
        }

        // 4. Process rows (only with tracking and NOT already in Shipped)
        const processedRows = sourceRows.slice(1).filter(row => {
            const tracking = row[colIndices.tracking];
            if (!tracking || tracking.trim() === '') return false;
            
            // Check if tracking is already in Shipped sheet E column
            return !existingTrackingInShipped.has(String(tracking).trim());
        }).map(row => {
            const destRow = new Array(10).fill(''); // A to J
            destRow[0] = row[colIndices.shipByDate] || '';
            destRow[1] = row[colIndices.orderNumber] || '';
            destRow[2] = row[colIndices.itemTitle] || '';
            destRow[3] = row[colIndices.quantity] || '';
            destRow[4] = row[colIndices.usavSku] || '';
            destRow[5] = row[colIndices.condition] || '';
            destRow[6] = row[colIndices.tracking] || '';
            // I (index 8) is blank
            destRow[9] = row[colIndices.note] || ''; // J (index 9)
            return destRow;
        });

        if (processedRows.length === 0) {
            return NextResponse.json({ success: true, message: 'No new rows (not in Shipped) found', rowCount: 0 });
        }

        // 5. Append to destination Orders sheet
        await sheets.spreadsheets.values.append({
            spreadsheetId: DEST_SPREADSHEET_ID,
            range: `${DEST_SHEET_NAME}!A:A`, 
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: processedRows,
            },
        });

        return NextResponse.json({ 
            success: true, 
            rowCount: processedRows.length, 
            tabName: targetTabName 
        });

    } catch (error: any) {
        console.error('Transfer error:', error);
        return NextResponse.json({ 
            success: false, 
            error: error.message || 'Internal Server Error' 
        }, { status: 500 });
    }
}
