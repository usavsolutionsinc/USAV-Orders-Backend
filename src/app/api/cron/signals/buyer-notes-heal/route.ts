/**
 * Nightly heal sweep for buyer-note signal derivation (plan §2.3 heal path).
 *
 * Re-scans each eBay-connected org's `orders` mirror (wide window) and emits
 * any `buyer_note` entity_signals the fresh path missed — a sync crash, a
 * deploy mid-run, a flag flipped on later. Signals derive from the LOCAL
 * mirror, so this sweep makes zero platform API calls; `source_ref`
 * idempotency (ux_entity_signals_source_ref + ON CONFLICT DO NOTHING) makes
 * re-emission structurally impossible, so drift cannot accumulate. A full
 * backfill is this sweep with `?limit=` widened.
 *
 * Per-tenant gate: deriveBuyerNoteSignals checks isBuyerNoteSignals(orgId)
 * itself (flag buyer_note_signals / env BUYER_NOTE_SIGNALS).
 *
 * House cron contract: isAuthorizedCronRequest → withCronLock → withCronRun;
 * registered in src/lib/cron/registry.ts + vercel.json (both SoTs).
 */
import { NextResponse, type NextRequest } from 'next/server';
import pool from '@/lib/db';
import { isAuthorizedCronRequest } from '@/lib/cron/auth';
import { withCronLock } from '@/lib/cron/lock';
import { withCronRun } from '@/lib/cron/run-log';
import type { OrgId } from '@/lib/tenancy/constants';
import { deriveBuyerNoteSignals } from '@/lib/surfaces/buyer-note-derivation';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const JOB = 'signals.buyer_notes_heal';

export async function GET(request: NextRequest) {
  if (!isAuthorizedCronRequest(request.headers)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const limitParam = Number(request.nextUrl.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 10_000) : 5_000;

  try {
    const locked = await withCronLock(JOB, () =>
      withCronRun(JOB, async () => {
        const { rows } = await pool.query<{ organization_id: string }>(
          `SELECT DISTINCT organization_id FROM ebay_accounts WHERE is_active = true`,
        );

        let orgsEnabled = 0;
        let emitted = 0;
        let duplicates = 0;
        let failed = 0;
        for (const row of rows) {
          const result = await deriveBuyerNoteSignals(row.organization_id as OrgId, { limit });
          if (!result.enabled) continue;
          orgsEnabled += 1;
          emitted += result.emitted;
          duplicates += result.duplicates;
          failed += result.failed;
        }

        return { orgsConnected: rows.length, orgsEnabled, emitted, duplicates, failed, limit };
      }),
    );
    if (!locked.ran) return NextResponse.json({ success: true, skipped: 'locked' });
    return NextResponse.json({ success: true, ...locked.result! });
  } catch (error) {
    console.error('[cron/signals.buyer_notes_heal]', error);
    const message = error instanceof Error ? error.message : 'Internal error';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
