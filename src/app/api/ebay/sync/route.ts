import { NextResponse } from 'next/server';
import { syncAllAccounts, getSyncStatus } from '@/lib/ebay/sync';
import { syncOrderExceptionsToOrders } from '@/lib/orders-exceptions';
import { isAllowedAdminOrigin } from '@/lib/security/allowed-origin';

/**
 * POST /api/ebay/sync
 * Trigger manual sync for all active eBay accounts
 */
export async function POST(req: Request) {
  const startedAt = Date.now();
  const runId = `ebay-sync-${startedAt}`;
  try {
    const origin = req.headers.get('origin');
    if (!isAllowedAdminOrigin(req)) {
      return NextResponse.json(
        { success: false, error: `Origin not allowed: ${origin}`, runId },
        { status: 403 }
      );
    }

    const url = new URL(req.url);
    const reconcileParam = url.searchParams.get('reconcileExceptions');
    const reconcileExceptions = reconcileParam === null ? true : reconcileParam === 'true';

    console.log(`[${runId}] Manual eBay sync triggered via API. reconcileExceptions=${reconcileExceptions}`);
    const results = await syncAllAccounts();

    const successCount = results.filter((r) => r.status === 'fulfilled').length;
    const failureCount = results.filter((r) => r.status === 'rejected').length;

    const totals = results.reduce(
      (acc, row) => {
        const data = row.data;
        acc.fetchedOrders += data?.fetchedOrders || 0;
        acc.scannedTracking += data?.scannedTracking || 0;
        acc.matchedExceptions += data?.matchedExceptions || 0;
        acc.createdOrders += data?.createdOrders || 0;
        acc.deletedExceptions += data?.deletedExceptions || 0;
        acc.skippedExistingOrders += data?.skippedExistingOrders || 0;
        acc.errors += data?.errors?.length || 0;
        return acc;
      },
      {
        fetchedOrders: 0,
        scannedTracking: 0,
        matchedExceptions: 0,
        createdOrders: 0,
        deletedExceptions: 0,
        skippedExistingOrders: 0,
        errors: 0,
      }
    );

    let exceptionsSync: { scanned: number; matched: number; deleted: number } | null = null;
    if (reconcileExceptions) {
      exceptionsSync = await syncOrderExceptionsToOrders();
    }

    const durationMs = Date.now() - startedAt;

    return NextResponse.json({
      success: true,
      runId,
      message: `eBay tracking-match sync completed: ${successCount} account(s) succeeded, ${failureCount} failed`,
      reconcileExceptions,
      totals,
      exceptionsSync,
      results,
      durationMs,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    const durationMs = Date.now() - startedAt;
    console.error(`[${runId}] Error in sync endpoint:`, error);
    return NextResponse.json(
      {
        success: false,
        runId,
        error: error.message,
        durationMs,
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
