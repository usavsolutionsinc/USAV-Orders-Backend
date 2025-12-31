import { NextResponse } from 'next/server';
import { syncAllSheets } from '@/lib/syncSheets';

export async function POST(request: Request) {
    try {
        console.log('[SYNC] Received POST request to /api/sync-sheets');
        
        const body = await request.json().catch(() => ({}));
        const { sheet_name, action, debug } = body;
        
        console.log('[SYNC] Request body:', { sheet_name, action, debug });
        
        // Check required environment variables (GOOGLE_SHEET_ID is optional - will auto-detect if not set)
        const requiredEnvVars = {
            DATABASE_URL: process.env.DATABASE_URL,
            GOOGLE_CLIENT_EMAIL: process.env.GOOGLE_CLIENT_EMAIL,
            GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY,
        };
        
        console.log('[SYNC] Environment check:', {
            has_db_url: !!requiredEnvVars.DATABASE_URL,
            has_client_email: !!requiredEnvVars.GOOGLE_CLIENT_EMAIL,
            has_private_key: !!requiredEnvVars.GOOGLE_PRIVATE_KEY,
            has_sheet_id: !!process.env.GOOGLE_SHEET_ID,
        });
        
        // Validate required environment variables (GOOGLE_SHEET_ID is optional)
        const missing = Object.entries(requiredEnvVars)
            .filter(([_, value]) => !value)
            .map(([key]) => key);
        
        if (missing.length > 0) {
            return NextResponse.json(
                {
                    success: false,
                    error: `Missing required environment variables: ${missing.join(', ')}`,
                    note: 'GOOGLE_SHEET_ID is optional - will auto-detect if service account has access',
                    debug: {
                        timestamp: new Date().toISOString(),
                        missing_vars: missing,
                    }
                },
                { status: 500 }
            );
        }
        
        // Run the sync
        console.log('[SYNC] Starting sync...');
        const result = await syncAllSheets(debug === true || debug === 'true');
        
        console.log('[SYNC] Sync completed successfully');
        
        return NextResponse.json({
            success: true,
            message: result.message || 'Sheets synced successfully',
            debug: {
                timestamp: new Date().toISOString(),
                method: 'typescript',
                debug_mode: debug === true || debug === 'true',
            }
        });

    } catch (error: any) {
        console.error('[SYNC] Error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error.message || 'Failed to sync sheets',
                details: error.toString(),
                debug: {
                    timestamp: new Date().toISOString(),
                    stack: error.stack,
                }
            },
            { status: 500 }
        );
    }
}

export async function GET(request: Request) {
    // Health check endpoint
    return NextResponse.json({
        status: 'ok',
        message: 'Sync endpoint is available. Use POST to trigger sync.',
        env_check: {
            has_db_url: !!process.env.DATABASE_URL,
            has_client_email: !!process.env.GOOGLE_CLIENT_EMAIL,
            has_private_key: !!process.env.GOOGLE_PRIVATE_KEY,
            has_sheet_id: !!process.env.GOOGLE_SHEET_ID,
        }
    });
}
