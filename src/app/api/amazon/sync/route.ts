import { NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { withCronRun } from '@/lib/cron/run-log';
import { syncOrgAmazonOrders } from '@/lib/amazon/order-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/amazon/sync
 *
 * Operator-triggered Amazon order import for the current org (same job the cron
 * runs; logged as a manual run). ?all=1 imports untracked SKUs too.
 */
export const POST = withAuth(async (req, ctx) => {
  const importAll = new URL(req.url).searchParams.get('all') === '1';
  try {
    const summary = await withCronRun(
      'amazon.orders_sync',
      () => syncOrgAmazonOrders(ctx.organizationId, { importAll, fetchPii: true }),
      { trigger: 'manual' },
    );
    const totals = summary.accounts.reduce(
      (a, r) => ({
        scanned: a.scanned + r.scanned,
        imported: a.imported + r.imported,
        updated: a.updated + r.updated,
        skippedUntracked: a.skippedUntracked + r.skippedUntracked,
        fbaReadOnly: a.fbaReadOnly + r.fbaReadOnly,
      }),
      { scanned: 0, imported: 0, updated: 0, skippedUntracked: 0, fbaReadOnly: 0 },
    );
    return NextResponse.json({ ok: true, totals, accounts: summary.accounts });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}, { permission: 'integrations.amazon' });
