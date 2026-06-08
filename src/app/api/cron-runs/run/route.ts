/**
 * POST /api/cron-runs/run?job=<key>  — admin "Run now".
 *
 * Triggers the job's cron route on this same deployment with the CRON_SECRET,
 * so the job runs through its normal withCronRun() path (and shows up in the
 * history). Gated by `admin.view`.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { CRON_JOB_TRIGGER_PATH } from '@/lib/cron/registry';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const POST = withAuth(
  async (req: NextRequest) => {
    const job = new URL(req.url).searchParams.get('job')?.trim() || '';
    const path = CRON_JOB_TRIGGER_PATH[job];
    if (!path) {
      return NextResponse.json({ ok: false, error: `Unknown or non-triggerable job: ${job}` }, { status: 400 });
    }
    const secret = process.env.CRON_SECRET;
    if (!secret) {
      return NextResponse.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 503 });
    }

    // Hit our own cron route (same origin) so it runs through withCronRun().
    const target = `${new URL(req.url).origin}${path}`;
    try {
      const res = await fetch(target, {
        method: 'GET',
        headers: { Authorization: `Bearer ${secret}` },
        cache: 'no-store',
      });
      const body = await res.json().catch(() => null);
      return NextResponse.json({ ok: res.ok, status: res.status, result: body });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'trigger failed';
      return NextResponse.json({ ok: false, error: message }, { status: 502 });
    }
  },
  { permission: 'admin.view' },
);
