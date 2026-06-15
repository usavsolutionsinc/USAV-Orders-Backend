/**
 * GET /api/cron/integrations/sync — connection-driven order sync.
 *
 * For every orders-capable connector with a wired sync(), sync every org that
 * has the provider connected. Auth via Bearer CRON_SECRET. This is the unified
 * replacement for the per-provider sync crons / manual backfill buttons.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { runOrdersSyncAllOrgs } from '@/lib/integrations/connectors/orchestrator';
import type { IntegrationProvider } from '@/lib/integrations/credentials';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req.headers)) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }
  // Optional ?providers=ebay,amazon to scope the run (default: all wired).
  const param = req.nextUrl.searchParams.get('providers');
  const only = param
    ? (param.split(',').map((s) => s.trim()).filter(Boolean) as IntegrationProvider[])
    : undefined;
  const summary = await withCronRun('integrations.orders_sync', async () => {
    const results = await runOrdersSyncAllOrgs(only);
    const imported = results.reduce((s, r) => s + (r.outcome.imported ?? 0), 0);
    const updated = results.reduce((s, r) => s + (r.outcome.updated ?? 0), 0);
    const failures = results.filter((r) => !r.outcome.ok).length;
    return { ran: results.length, imported, updated, failures, results };
  });
  return NextResponse.json({ ok: true, summary });
}
