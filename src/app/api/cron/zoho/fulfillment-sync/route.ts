/**
 * GET /api/cron/zoho/fulfillment-sync?mode=delta|full&dry_run=0|1&limit=100
 *
 * Vercel-cron-triggered push of SHIPPED internal orders into Zoho Inventory:
 * for each shipped order it ensures a sales order, then creates a package,
 * shipment order, marks delivered (when tracking says so), and creates the
 * invoice — so a proper accounting record lands in the Zoho finance ecosystem.
 *
 * Modes:
 *   - delta: only orders changed since the last successful run (cursor-based)
 *   - full:  scan all shipped orders (bounded by limit); nightly safety net
 *
 * Safety: the sync is DRY-RUN by default (ZOHO_FULFILLMENT_DRY_RUN, default
 * true) — it logs intended actions and writes nothing to Zoho until you set
 * ZOHO_FULFILLMENT_DRY_RUN=false (or pass ?dry_run=0). The cursor only advances
 * on a fully error-free LIVE run.
 *
 * Auth: requires Authorization: Bearer ${CRON_SECRET} (Vercel injects this).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSyncCursor, updateSyncCursor } from '@/lib/sync-cursors';
import { syncShippedOrdersToZoho } from '@/lib/zoho/fulfillment-sync';
import { getFulfillmentSyncConfig } from '@/lib/zoho/fulfillment-config';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CURSOR_KEY = 'zoho_fulfillment_sync';

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get('authorization') === `Bearer ${secret}`;
}

function parseDryRun(value: string | null): boolean | undefined {
  if (value == null) return undefined;
  const v = value.toLowerCase();
  if (v === '0' || v === 'false' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'yes') return true;
  return undefined;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get('mode') === 'full' ? 'full' : 'delta';
  const dryRunOverride = parseDryRun(url.searchParams.get('dry_run'));
  const limitParam = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.floor(limitParam) : undefined;

  const config = getFulfillmentSyncConfig();

  try {
    // Delta cursor — first run bootstraps from configurable lookback.
    let since: Date | null = null;
    if (mode === 'delta') {
      const cursor = await getSyncCursor(CURSOR_KEY);
      since = cursor ?? new Date(Date.now() - config.bootstrapLookbackDays * 24 * 60 * 60 * 1000);
    }

    const report = await syncShippedOrdersToZoho({ since, dryRun: dryRunOverride, limit });

    // Advance the cursor only after an error-free LIVE run. Dry runs never move it.
    if (!report.dryRun && report.errored === 0) {
      await updateSyncCursor(CURSOR_KEY, new Date(report.runStartedAt));
    }

    return NextResponse.json({
      ok: report.errored === 0,
      mode,
      dryRun: report.dryRun,
      invoiceMode: report.invoiceMode,
      cursor: { resource: CURSOR_KEY, since: since?.toISOString() ?? null },
      totals: {
        scanned: report.scanned,
        completed: report.completed,
        skipped: report.skipped,
        errored: report.errored,
      },
      errors: report.errors.slice(0, 25),
      elapsedMs: report.elapsedMs,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'fulfillment-sync failed';
    console.error('[cron/zoho/fulfillment-sync]', error);
    return NextResponse.json({ ok: false, mode, error: message }, { status: 500 });
  }
}
