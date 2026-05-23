/**
 * GET /api/cron/reconcile-unmatched
 *
 * Vercel-cron-triggered sweep that re-checks recent unmatched receivings
 * for a Zoho PO match. When a PO has arrived in Zoho since the original
 * tracking scan, the matching receiving row is promoted in place.
 *
 * Suggested schedule: hourly. Tighter cadence wastes Zoho API quota on
 * receivings that almost never get a same-day match; looser cadence delays
 * operator visibility into the now-matched state.
 *
 * Auth: requires Authorization: Bearer ${CRON_SECRET}. Mirrors the contract
 * used by /api/cron/zoho/po-sync — Vercel auto-injects this header when
 * CRON_SECRET is set in the project.
 *
 * Query params:
 *   ?maxAgeDays=<n>  (default 7, clamped to 1..30)
 *   ?limit=<n>       (default 50, clamped to 1..200)
 */

import { NextRequest, NextResponse } from 'next/server';
import { sweepUnmatchedReceivings } from '@/lib/receiving/reconcile-unmatched';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startedAt = Date.now();
  const url = new URL(req.url);
  const maxAgeDays = Number(url.searchParams.get('maxAgeDays') ?? 7);
  const limit = Number(url.searchParams.get('limit') ?? 50);

  try {
    const summary = await sweepUnmatchedReceivings({
      maxAgeDays: Number.isFinite(maxAgeDays) ? maxAgeDays : 7,
      limit: Number.isFinite(limit) ? limit : 50,
    });

    // Structured single-line log so cron runs are scrape-able in the Vercel
    // function logs without parsing pretty JSON. Per-row reasons stay in the
    // returned payload (and the JSON response body the cron caller gets).
    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[cron.reconcile-unmatched] scanned=${summary.scanned} promoted=${summary.promoted} skipped=${summary.scanned - summary.promoted} elapsed_ms=${elapsedMs}`,
    );

    return NextResponse.json({
      success: true,
      elapsed_ms: elapsedMs,
      ...summary,
    });
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : 'sweep failed';
    console.error(
      `[cron.reconcile-unmatched] elapsed_ms=${elapsedMs} error="${message}"`,
      err,
    );
    return NextResponse.json(
      { success: false, elapsed_ms: elapsedMs, error: message },
      { status: 500 },
    );
  }
}
