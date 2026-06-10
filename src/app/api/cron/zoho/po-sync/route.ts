/**
 * GET /api/cron/zoho/po-sync?mode=delta|full
 *
 * Vercel-cron-triggered sync of Zoho purchase orders into the
 * zoho_po_mirror table. The mirror feeds the PO email reconciler and the
 * Incoming/triage zoho_status reads. The sync also runs one follow-up
 * workflow write (inside syncZohoPoMirror): door-scanned receiving_lines
 * whose PO Zoho now reports received/billed/closed are marked received
 * locally, so they drop off the triage Prioritize queue without an
 * operator manually receiving each one.
 *
 * Modes:
 *   - delta: passes last_modified_time so Zoho returns only changed POs
 *   - full:  no filter; brings everything (nightly safety net)
 *
 * Auth: requires Authorization: Bearer ${CRON_SECRET}. Vercel injects
 * this header automatically when CRON_SECRET env var is set in the
 * project. We hard-require the secret in every environment.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { syncZohoPoMirror } from '@/lib/zoho/po-mirror-sync';
import { getSyncCursor, updateSyncCursor } from '@/lib/sync-cursors';
import { formatApiOffsetTimestamp } from '@/utils/date';
import { withCronRun } from '@/lib/cron/run-log';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CURSOR_KEY = 'zoho_po_mirror';

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
  const mode = url.searchParams.get('mode') === 'full' ? 'full' : 'delta';

  // Delta cursor — last successful sync time. First run bootstraps from
  // 7 days back to keep the initial pull bounded.
  let lastModified: string | undefined = undefined;
  if (mode === 'delta') {
    const cursor = await getSyncCursor(CURSOR_KEY);
    const start = cursor ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    lastModified = formatApiOffsetTimestamp(start);
  }

  const report = await withCronRun(`zoho.po_sync`, () =>
    syncZohoPoMirror({
      mode,
      lastModifiedTime: lastModified,
      maxPages: 200,
      maxItems: 20000,
    }),
  );

  // Advance cursor on a successful run, even if zero changes.
  if (report.errors.length === 0) {
    await updateSyncCursor(CURSOR_KEY, new Date());
  }

  // Auto-resolve worklist rows whose PO has since landed in the mirror.
  // Two match paths:
  //   1. Any extracted PO# from the email appears in the mirror — covers
  //      the "vendor finally created the Zoho PO" case.
  //   2. The human typed a Zoho PO# into the triage checklist
  //      (zoho_uploaded_po_number) and that number now exists in the
  //      mirror — covers the "human uploaded to Zoho, waiting for sync"
  //      case where the email's extracted PO# may not match what the
  //      human actually entered (typos, prefix changes, etc).
  //
  // Rows in piles `inbox` and `upload` are eligible; `ignore` and `done`
  // are terminal. Writing `pile='done'` lets the trigger derive
  // status='resolved' and stamp resolved_at.
  const resolved = await pool.query(
    `UPDATE email_missing_purchase_orders e
        SET pile = 'done'
      WHERE e.pile IN ('inbox', 'upload')
        AND EXISTS (
          SELECT 1
            FROM zoho_po_mirror m
           WHERE m.zoho_purchaseorder_number_norm = ANY(e.po_numbers_norm)
              OR (
                e.zoho_uploaded_po_number IS NOT NULL
                AND m.zoho_purchaseorder_number_norm =
                  NULLIF(upper(regexp_replace(e.zoho_uploaded_po_number, '[^A-Za-z0-9]', '', 'g')), '')
              )
        )`,
  );

  return NextResponse.json({
    ok: report.errors.length === 0,
    mode,
    cursor: { resource: CURSOR_KEY, last_modified_time: lastModified ?? null },
    totals: {
      pages: report.pages,
      fetched: report.fetched,
      upserted: report.upserted,
      lines_marked_received: report.reconciled,
    },
    autoResolved: resolved.rowCount ?? 0,
    errors: report.errors.slice(0, 25),
    elapsedMs: Date.now() - startedAt,
  });
}
