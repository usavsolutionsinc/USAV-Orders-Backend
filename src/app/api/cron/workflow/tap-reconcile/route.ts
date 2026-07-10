/**
 * Cron: re-drive workflow taps that never landed.
 *
 * GET /api/cron/workflow/tap-reconcile?olderThan=10&limit=50
 *
 * The reconciler half of the intended-tap outbox (roi-execution/03 #10).
 * tapWorkflow records an INTENT row (workflow_tap_outbox, status='PENDING')
 * before attempting advance() and marks it LANDED on a durable outcome; a row
 * stuck PENDING past `olderThan` minutes means the tap was lost (crash
 * mid-advance, transient lock). This route claims those rows (attempts bumped,
 * SKIP LOCKED) and re-drives each through the SAME tap entry — tapWorkflow is
 * idempotent by design, so a re-drive of a tap that actually landed is a safe
 * re-park, and the re-driven tap marks its own row LANDED/FAILED. Rows past
 * MAX_ATTEMPTS are flipped FAILED for human triage instead of looping forever.
 *
 * Flag-gated on WORKFLOW_TAP_OUTBOX (default OFF) — fully inert until the
 * 2026-07-09b_workflow_tap_outbox migration is applied and the flag is on.
 * NOT added to vercel.json: scheduling this cron is an owner decision.
 *
 * Auth: Vercel cron origin or CRON_SECRET bearer (same gate as the other
 * /api/cron routes). Cron routes are session-less by design — no staff
 * session wrapper (see docs/security/route-permissions.json exemption
 * pattern for /api/cron/*).
 */

import { NextRequest, NextResponse } from 'next/server';
import { isVercelCronOrigin } from '@/lib/cron/auth';
import { withCronLock } from '@/lib/cron/lock';
import { isWorkflowTapOutboxEnabled } from '@/lib/feature-flags';
import {
  defaultTapDeps,
  tapWorkflow,
  type TapDeps,
  type WorkflowTapEvent,
} from '@/lib/workflow/tap';
import {
  claimStaleTapIntents,
  markTapIntentFailed,
  type StaleTapIntent,
} from '@/lib/workflow/tap-outbox';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** After this many claims a PENDING row is flipped FAILED for human triage. */
const MAX_ATTEMPTS = 5;

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}

/**
 * Re-drive deps: identical to production except recordIntent resolves to the
 * already-claimed row id — the re-driven tap updates the EXISTING intent
 * (LANDED/FAILED) instead of inserting a duplicate PENDING row.
 */
function redriveDeps(intentId: number): TapDeps {
  return {
    ...defaultTapDeps,
    outboxEnabled: () => true,
    outbox: {
      ...defaultTapDeps.outbox,
      recordIntent: async () => intentId,
    },
  };
}

function toTapArgs(row: StaleTapIntent) {
  const p = row.payload as {
    input?: Record<string, unknown>;
    staffId?: number | null;
    source?: string | null;
    expectNodeType?: string | null;
  };
  return {
    serialUnitId: row.serialUnitId,
    event: row.eventType as WorkflowTapEvent,
    input: p.input ?? undefined,
    staffId: p.staffId ?? null,
    source: (p.source ?? undefined) as Parameters<typeof tapWorkflow>[0]['source'],
    orgId: row.organizationId,
    expectNodeType: p.expectNodeType ?? undefined,
  };
}

export async function GET(req: NextRequest) {
  if (!isVercelCronOrigin(req.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!isWorkflowTapOutboxEnabled()) {
    return NextResponse.json({ ok: true, skipped: 'flag_off' });
  }

  const olderThanMinutes = clampInt(req.nextUrl.searchParams.get('olderThan'), 10, 1, 1440);
  const limit = clampInt(req.nextUrl.searchParams.get('limit'), 50, 1, 200);

  let claimed = 0;
  let redriven = 0;
  let exhausted = 0;

  try {
    const locked = await withCronLock('workflow-tap-reconcile', async () => {
      const rows = await claimStaleTapIntents({ olderThanMinutes, limit });
      claimed = rows.length;

      for (const row of rows) {
        if (row.attempts > MAX_ATTEMPTS) {
          await markTapIntentFailed(row.id, 'max_attempts');
          exhausted += 1;
          continue;
        }
        // Same tap entry as production — never throws; on success it marks the
        // claimed row LANDED via the redrive deps, on a durable non-apply it
        // marks FAILED, and on a transient loss it leaves the row PENDING for
        // the next run.
        await tapWorkflow(toTapArgs(row), redriveDeps(row.id));
        redriven += 1;
      }
    });
    if (!locked.ran) {
      return NextResponse.json({ ok: true, skipped: 'locked' });
    }
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'reconcile failed',
        claimed,
        redriven,
        exhausted,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, claimed, redriven, exhausted });
}
