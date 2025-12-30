import { NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

export async function POST(request: Request) {
    try {
        console.log('[SYNC] Received POST request to /api/sync-sheets');
        
        const body = await request.json().catch(() => ({}));
        const { sheet_name, action, debug } = body;
        
        console.log('[SYNC] Request body:', { sheet_name, action, debug });

        // Run the Python sync script (try direct API first, fallback to Apps Script)
        const scriptPath = path.join(process.cwd(), 'scripts', 'sync_sheets_direct.py');
        const fallbackScriptPath = path.join(process.cwd(), 'scripts', 'sync_sheets_to_db.py');
        
        let stdout = '';
        let stderr = '';
        let success = false;
        
        // Prepare environment variables
        const env: Record<string, string | undefined> = {
            ...process.env,
            DATABASE_URL: process.env.DATABASE_URL,
            GOOGLE_CLIENT_EMAIL: process.env.GOOGLE_CLIENT_EMAIL,
            GOOGLE_PRIVATE_KEY: process.env.GOOGLE_PRIVATE_KEY,
            GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID,
            APPS_SCRIPT_WEBAPP_URL: process.env.APPS_SCRIPT_WEBAPP_URL,
        };
        
        console.log('[SYNC] Environment check:', {
            has_db_url: !!env.DATABASE_URL,
            has_client_email: !!env.GOOGLE_CLIENT_EMAIL,
            has_private_key: !!env.GOOGLE_PRIVATE_KEY,
            has_sheet_id: !!env.GOOGLE_SHEET_ID,
            has_apps_script_url: !!env.APPS_SCRIPT_WEBAPP_URL,
        });
        
        try {
            // Try direct API first
            console.log('[SYNC] Attempting direct API sync...');
            const result = await execAsync(`python3 "${scriptPath}"`, {
                env,
                maxBuffer: 10 * 1024 * 1024,
            });
            stdout = result.stdout;
            stderr = result.stderr;
            success = true;
            console.log('[SYNC] Direct API sync completed');
        } catch (error: any) {
            console.log('[SYNC] Direct API failed, trying Apps Script method...', error.message);
            // Fallback to Apps Script method
            const result = await execAsync(`python3 "${fallbackScriptPath}"`, {
                env,
                maxBuffer: 10 * 1024 * 1024,
            });
            stdout = result.stdout;
            stderr = result.stderr;
            success = true;
            console.log('[SYNC] Apps Script sync completed');
        }

        if (stderr && !stderr.includes('Warning') && !stderr.includes('INFO')) {
            console.error('[SYNC] Script stderr:', stderr);
        }

        console.log('[SYNC] Sync completed, returning response');
        
        return NextResponse.json({
            success: true,
            message: 'Sheets synced successfully',
            output: stdout,
            stderr: stderr || undefined,
            debug: {
                script_used: success ? 'sync_sheets_direct.py' : 'sync_sheets_to_db.py',
                timestamp: new Date().toISOString(),
            }
        });

    } catch (error: any) {
        console.error('[SYNC] Error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error.message || 'Failed to sync sheets',
                details: error.stderr || error.stdout || error.toString(),
                debug: {
                    timestamp: new Date().toISOString(),
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
    });
}
