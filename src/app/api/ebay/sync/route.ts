import { NextResponse } from 'next/server';
import { syncAllAccounts, getSyncStatus } from '@/lib/ebay/sync';

function isAllowedSyncRequest(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;

  try {
    const originUrl = new URL(origin);
    const forwardedHost = req.headers.get('x-forwarded-host');
    const host = req.headers.get('host');
    const requestHost = (forwardedHost || host || '').toLowerCase();
    const originHost = originUrl.host.toLowerCase();

    // Allow exact same-origin requests (covers production custom domains and previews).
    if (requestHost && requestHost === originHost) return true;

    // Keep localhost for local development flexibility.
    if (originHost === 'localhost:3000' || originHost === '127.0.0.1:3000') return true;

    // Allow Vercel preview/prod subdomains.
    if (originUrl.hostname.endsWith('.vercel.app')) return true;
  } catch {
    return false;
  }

  return false;
}

/**
 * POST /api/ebay/sync
 * Trigger manual sync for all active eBay accounts
 */
export async function POST(req: Request) {
  try {
    const origin = req.headers.get('origin');
    if (!isAllowedSyncRequest(req)) {
      return NextResponse.json(
        { success: false, error: `Origin not allowed: ${origin}` },
        { status: 403 }
      );
    }

    console.log('Manual sync triggered via API');
    const results = await syncAllAccounts();
    
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failureCount = results.filter(r => r.status === 'rejected').length;
    
    return NextResponse.json({
      success: true,
      message: `Sync completed: ${successCount} succeeded, ${failureCount} failed`,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error in sync endpoint:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error.message,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/ebay/sync
 * Get sync status for all accounts
 */
export async function GET() {
  try {
    const status = await getSyncStatus();
    
    return NextResponse.json({
      success: true,
      accounts: status,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Error fetching sync status:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: error.message 
      },
      { status: 500 }
    );
  }
}
