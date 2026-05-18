import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';

// This endpoint will append data to Google Sheets
// You'll need to set up Google Sheets API credentials and use google-auth-library

export const POST = withAuth(async (request: NextRequest) => {
    await request.text().catch(() => '');
    return NextResponse.json({
        success: false,
        error: 'Google Sheets append support has been removed. Persist data directly to the database.',
    }, { status: 410 });
}, { permission: 'admin.manage_features' });
