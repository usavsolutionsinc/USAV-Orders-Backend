import { syncAllAccounts } from '@/lib/ebay/sync';
import { syncOrderExceptionsToOrders } from '@/lib/orders-exceptions';
import { formatPSTTimestamp } from '@/utils/date';

export async function runEbaySync(options?: { reconcileExceptions?: boolean }) {
  const startedAt = Date.now();
  const runId = `ebay-sync-${startedAt}`;
  const reconcileExceptions = options?.reconcileExceptions ?? true;

  try {
    console.log(`[${runId}] eBay sync triggered. reconcileExceptions=${reconcileExceptions}`);
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

    return {
      success: true,
      runId,
      message: `eBay tracking-match sync completed: ${successCount} account(s) succeeded, ${failureCount} failed`,
      reconcileExceptions,
      totals,
      exceptionsSync,
      results,
      durationMs,
      timestamp: formatPSTTimestamp(),
    };
  } catch (error: any) {
    const durationMs = Date.now() - startedAt;
    console.error(`[${runId}] Error in sync job:`, error);
    throw Object.assign(new Error(error?.message || 'eBay sync failed'), {
      cause: {
        success: false,
        runId,
        error: error?.message || 'eBay sync failed',
        durationMs,
        timestamp: formatPSTTimestamp(),
      },
    });
  }
}
