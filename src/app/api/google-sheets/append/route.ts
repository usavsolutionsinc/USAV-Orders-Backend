import { NextRequest, NextResponse } from 'next/server';

// This endpoint will append data to Google Sheets
// You'll need to set up Google Sheets API credentials and use google-auth-library

export async function POST(request: NextRequest) {
    await request.text().catch(() => '');
    return NextResponse.json({
        success: false,
        error: 'Google Sheets append support has been removed. Persist data directly to the database.',
    }, { status: 410 });
}
