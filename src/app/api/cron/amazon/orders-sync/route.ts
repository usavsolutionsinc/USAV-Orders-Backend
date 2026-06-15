import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { syncOrgAmazonOrders, type AmazonOrderSyncResult } from '@/lib/amazon/order-sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function aggregate(rows: AmazonOrderSyncResult[]) {
  return rows.reduce(
    (a, r) => ({
      scanned: a.scanned + r.scanned,
      imported: a.imported + r.imported,
      updated: a.updated + r.updated,
      skippedUntracked: a.skippedUntracked + r.skippedUntracked,
      fbaReadOnly: a.fbaReadOnly + r.fbaReadOnly,
    }),
    { scanned: 0, imported: 0, updated: 0, skippedUntracked: 0, fbaReadOnly: 0 },
  );
}

/**
 * GET /api/cron/amazon/orders-sync
 *
 * Incremental Amazon order import for every org with an active account. Auth via
 * Bearer CRON_SECRET. ?all=1 imports untracked SKUs too (default: tracked-only).
 */
export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req.headers)) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const importAll = req.nextUrl.searchParams.get('all') === '1';

  try {
    const summary = await withCronRun('amazon.orders_sync', async () => {
      const { rows } = await pool.query<{ organization_id: string }>(
        `SELECT DISTINCT organization_id FROM amazon_accounts WHERE is_active = true`,
      );
      const perOrg = [];
      for (const row of rows) {
        perOrg.push(await syncOrgAmazonOrders(row.organization_id, { importAll, fetchPii: true }));
      }
      const totals = aggregate(perOrg.flatMap((o) => o.accounts));
      return { orgs: perOrg.length, totals, perOrg };
    });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err: any) {
    console.error('[cron/amazon/orders-sync]', err?.message || err);
    return NextResponse.json({ ok: false, error: err?.message || String(err) }, { status: 500 });
  }
}
