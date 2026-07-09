import { NextResponse } from 'next/server';
import { getSyncStatus } from '@/lib/ebay/sync';
import { runEbaySync } from '@/lib/jobs/ebay-sync';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';
import { withAuth } from '@/lib/auth/withAuth';

export const POST = withAuth(async (req: Request) => {
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
}, { permission: 'integrations.ebay' });

/**
 * GET /api/ebay/sync
 * Get sync status for all accounts
 */
export const GET = withAuth(async (_req, ctx) => {
  try {
    const status = await getSyncStatus(ctx.organizationId);
    
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
}, { permission: 'integrations.ebay' });
