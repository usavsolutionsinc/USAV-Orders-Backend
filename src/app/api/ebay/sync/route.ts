import { NextResponse } from 'next/server';
import { getSyncStatus } from '@/lib/ebay/sync';
import { runEbaySync } from '@/lib/jobs/ebay-sync';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';
import { enqueueQStashJson, getQStashResultIdentifier } from '@/lib/qstash';

export async function POST(req: Request) {
  const origin = req.headers.get('origin');
  if (!isAllowedAdminOrigin(req)) {
    return NextResponse.json(
      { success: false, error: `Origin not allowed: ${origin}` },
      { status: 403 }
    );
  }

  try {
    const url = new URL(req.url);
    const reconcileParam = url.searchParams.get('reconcileExceptions');
    const reconcileExceptions = reconcileParam === null ? true : reconcileParam === 'true';
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const enqueue = body?.enqueue === true || url.searchParams.get('enqueue') === 'true';
    if (enqueue) {
      const result = await enqueueQStashJson({
        path: '/api/qstash/ebay/sync',
        body: { reconcileExceptions },
        retries: 3,
        timeout: 300,
        label: 'ebay-sync',
      });
      return NextResponse.json({
        success: true,
        queued: true,
        messageId: getQStashResultIdentifier(result),
      });
    }
    return NextResponse.json(await runEbaySync({ reconcileExceptions }));
  } catch (error: any) {
    const payload = error?.cause;
    return NextResponse.json(
      payload ?? {
        success: false,
        error: error?.message || 'Internal error',
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
