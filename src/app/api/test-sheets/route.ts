import { NextResponse } from 'next/server';
import { google } from 'googleapis';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const sheetName = searchParams.get('sheet') || 'Orders';
        const maxRows = parseInt(searchParams.get('maxRows') || '5');
        
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;
        if (!spreadsheetId) {
            return NextResponse.json({
                error: 'GOOGLE_SHEET_ID not set',
            }, { status: 500 });
        }
        
        // Authenticate
        const auth = new google.auth.JWT({
            email: process.env.GOOGLE_CLIENT_EMAIL,
            key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });
        
        const sheets = google.sheets({ version: 'v4', auth });
        
        // First, get all sheet names
        console.log(`[TEST] Fetching metadata for spreadsheet: ${spreadsheetId}`);
        const metadata = await sheets.spreadsheets.get({
            spreadsheetId,
        });
        
        const allSheetNames = (metadata.data.sheets || []).map((s: any) => s.properties?.title || '').filter((n: string) => n);
        
        // Try to get data from the requested sheet
        let sheetData = null;
        let sheetError = null;
        
        // Try exact name first
        try {
            const range = `${sheetName}!A:Z`;
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId,
                range,
            });
            sheetData = {
                range: response.data.range,
                values: response.data.values?.slice(0, maxRows) || [],
                totalRows: response.data.values?.length || 0,
            };
        } catch (error: any) {
            sheetError = {
                code: error.code,
                message: error.message,
                details: error.response?.data,
            };
            
            // Try case variations
            const variations = [
                sheetName.charAt(0).toUpperCase() + sheetName.slice(1).toLowerCase(),
                sheetName.toUpperCase(),
                sheetName.toLowerCase(),
            ];
            
            for (const variation of variations) {
                try {
                    const range = `${variation}!A:Z`;
                    const response = await sheets.spreadsheets.values.get({
                        spreadsheetId,
                        range,
                    });
                    sheetData = {
                        range: response.data.range,
                        values: response.data.values?.slice(0, maxRows) || [],
                        totalRows: response.data.values?.length || 0,
                        matchedName: variation,
                        originalName: sheetName,
                    };
                    sheetError = null;
                    break;
                } catch (e: any) {
                    continue;
                }
            }
        }
        
        return NextResponse.json({
            success: true,
            spreadsheetId,
            spreadsheetTitle: metadata.data.properties?.title,
            allSheetNames,
            requestedSheet: sheetName,
            sheetData,
            sheetError,
            timestamp: new Date().toISOString(),
        });
        
    } catch (error: any) {
        console.error('[TEST] Error:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to fetch sheet data',
            details: error.toString(),
            stack: error.stack,
        }, { status: 500 });
    }
}
