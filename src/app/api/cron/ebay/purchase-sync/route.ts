import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { withCronLock } from '@/lib/cron/lock';
import { forEachOrgWithProvider } from '@/lib/cron/for-each-org';
import { syncEbayPurchasesToReceiving } from '@/lib/inbound/sync-ebay-purchases';
import { isIncomingUniversal } from '@/lib/feature-flags';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET /api/cron/ebay/purchase-sync  (Vercel cron, ~30–60 min)
 * Universal Incoming Track A: sync each org's connected eBay BUYER accounts'
 * purchases into Incoming (plan §5.3). Only orgs with the incoming_universal flag
 * ON are swept; the eBay Buy Order API adapter is a no-op until buy.order.readonly
 * is approved, so this is a safe no-op cron until then.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const locked = await withCronLock('ebay.purchase_sync', () =>
      withCronRun('ebay.purchase_sync', async () => {
        const results = await forEachOrgWithProvider('ebay', async (orgId) => {
          if (!(await isIncomingUniversal(orgId))) return { skipped: 'flag_off' as const };
          return syncEbayPurchasesToReceiving(orgId);
        });
        let ingested = 0;
        let orgsRun = 0;
        const errors: string[] = [];
        for (const r of results) {
          if (!r.ok) { errors.push(`${r.orgId}: ${r.error instanceof Error ? r.error.message : String(r.error)}`); continue; }
          if (r.result && 'ingested' in r.result) {
            orgsRun += 1;
            ingested += r.result.ingested;
            if (r.result.errors.length) errors.push(...r.result.errors.map((e) => `${r.orgId}: ${e}`));
          }
        }
        return { orgs: results.length, orgsRun, ingested, errors };
      }),
    );
    if (!locked.ran) {
      return NextResponse.json({ success: true, skipped: 'locked' });
    }
    return NextResponse.json({ success: true, ...locked.result });
  } catch (error: unknown) {
    console.error('[ebay/purchase-sync]', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal error' },
      { status: 500 },
    );
  }
}
