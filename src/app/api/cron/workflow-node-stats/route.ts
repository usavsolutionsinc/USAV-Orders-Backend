import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronRun } from '@/lib/cron/run-log';
import { withCronLock } from '@/lib/cron/lock';
import { runWorkflowNodeStatsSnapshot } from '@/lib/workflow/node-stats';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/workflow-node-stats  (Vercel cron, daily 00:45)
 *
 * Snapshots per-node workflow queue depth into workflow_node_stats so the
 * Studio's Flow² trends accrue from day one (ST2 of the Operations Studio
 * plan). Idempotent per day.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const locked = await withCronLock('workflow.node_stats', () =>
      withCronRun('workflow.node_stats', () => runWorkflowNodeStatsSnapshot()),
    );
    if (!locked.ran) {
      return NextResponse.json({ success: true, skipped: 'locked' });
    }
    const result = locked.result!;
    console.log('[workflow-node-stats] Completed', result);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[workflow-node-stats]', error);
    const message = error instanceof Error ? error.message : 'Internal error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
