/**
 * GET /api/cron/integrations/reconcile — daily drift repair.
 *
 * For every connector with a wired reconcile(), compare the provider's recently
 * modified records against local state and fix either side (catches dropped
 * webhooks / failed outbound pushes that polling alone misses). No-op until
 * providers implement reconcile(); safe to schedule now. Auth via CRON_SECRET.
 *
 * Optional ?hours=N sets the lookback window (default 25h — slightly over a day
 * to tolerate clock skew, matching the ERP reconciliation job).
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { runReconcileAllOrgs } from '@/lib/integrations/connectors/orchestrator';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req.headers)) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }
  const hoursParam = Number(req.nextUrl.searchParams.get('hours'));
  const hours = Number.isFinite(hoursParam) && hoursParam > 0 ? hoursParam : 25;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const summary = await withCronRun('integrations.reconcile', async () => {
    const results = await runReconcileAllOrgs({ since });
    const inboundFixed = results.reduce((s, r) => s + (r.outcome.inboundFixed ?? 0), 0);
    const outboundFixed = results.reduce((s, r) => s + (r.outcome.outboundFixed ?? 0), 0);
    const failures = results.filter((r) => !r.outcome.ok).length;
    return { ran: results.length, inboundFixed, outboundFixed, failures, results };
  });
  return NextResponse.json({ ok: true, summary });
}
