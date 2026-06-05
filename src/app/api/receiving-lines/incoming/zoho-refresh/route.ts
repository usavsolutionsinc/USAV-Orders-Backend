/**
 * POST /api/receiving-lines/incoming/zoho-refresh
 *
 * Operator-triggered "Refresh Zoho" button on the Incoming sidebar. Does the
 * two Zoho pulls that keep the Incoming queue honest, on demand:
 *
 *   1. Issued-PO sync (syncZohoPurchaseOrdersToReceiving, status='issued') —
 *      brings in newly-issued POs and refreshes header fields on existing
 *      EXPECTED rows. This is the same delta the incoming-po-sync cron runs.
 *
 *   2. PO-mirror status sync (syncZohoPoMirror, delta) — refreshes
 *      `zoho_po_mirror.status`. This is what makes a *received* PO disappear:
 *      a PO that left 'issued' (now billed/closed/received) is no longer in the
 *      issued pull, so step 1 never re-touches it. Step 2 updates its mirror
 *      status, and the Incoming summary/list filter
 *      (NOT_ZOHO_RECEIVED_PREDICATE) then drops it from the display.
 *
 * After both, we invalidate the receiving-lines cache tags so the rail and
 * tiles reflect the fresh state on the operator's next refetch.
 *
 * Unlike the crons (Bearer CRON_SECRET), this is gated by the operator's
 * receiving permission — it's a UI affordance, not an automated job.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/lib/auth/withAuth';
import { errorResponse } from '@/lib/api';
import { syncZohoPurchaseOrdersToReceiving } from '@/lib/zoho-receiving-sync';
import { syncZohoPoMirror } from '@/lib/zoho/po-mirror-sync';
import { getSyncCursor, updateSyncCursor } from '@/lib/sync-cursors';
import { formatApiOffsetTimestamp } from '@/utils/date';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MIRROR_CURSOR_KEY = 'zoho_po_mirror';

export const POST = withAuth(async (_req: NextRequest) => {
  const startedAt = Date.now();
  try {
    // ── 1. Issued POs → receiving_lines (same policy as the cron) ──────────
    const issued = await syncZohoPurchaseOrdersToReceiving({
      status: 'issued',
      days_back: 0,
      per_page: 200,
      max_pages: 25,
      max_items: 2000,
      po_date_floor: '2026-05-08',
    });

    // ── 2. Mirror status refresh (delta) — drives the received-clears ──────
    const mirrorCursor = await getSyncCursor(MIRROR_CURSOR_KEY);
    const mirrorStart = mirrorCursor ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const mirror = await syncZohoPoMirror({
      mode: 'delta',
      lastModifiedTime: formatApiOffsetTimestamp(mirrorStart),
      maxPages: 200,
      maxItems: 20000,
    });
    if (mirror.errors.length === 0) {
      await updateSyncCursor(MIRROR_CURSOR_KEY, new Date());
    }

    // ── 3. Invalidate so the rail + tiles reflect the fresh state ──────────
    try {
      await invalidateCacheTags(['receiving-lines', 'receiving-logs']);
    } catch (err) {
      console.warn('incoming/zoho-refresh: cache invalidate failed (non-fatal)', err);
    }

    return NextResponse.json({
      ok: issued.failed === 0 && mirror.errors.length === 0,
      issued: {
        processed: issued.processed,
        created: issued.created,
        updated: issued.updated,
        linked: issued.linked,
        failed: issued.failed,
      },
      // `mirror_upserted` includes POs whose status changed to received/closed —
      // those are the rows that clear from Incoming on the next read.
      mirror: {
        mode: mirror.mode,
        fetched: mirror.fetched,
        upserted: mirror.upserted,
        errors: mirror.errors.slice(0, 5),
      },
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    return errorResponse(error, 'POST /api/receiving-lines/incoming/zoho-refresh');
  }
}, { permission: 'receiving.view' });
