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
import { withCronRun } from '@/lib/cron/run-log';
import { withCronLock } from '@/lib/cron/lock';
import { forEachOrgWithProvider } from '@/lib/cron/for-each-org';
import { syncShippedOrdersToZoho, type SyncRunReport } from '@/lib/zoho/fulfillment-sync';
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

  const startedAt = Date.now();
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

    // Distributed lock so an overlapping tick / manual trigger / Vercel retry
    // can't double-push. Fan out per Zoho-connected org (plus USAV while it uses
    // env creds): each org pushes its OWN shipped orders under its OWN Zoho
    // credential (syncShippedOrdersToZoho org-scopes the order load + binds
    // withZohoCredential). Per-org failures are isolated.
    const locked = await withCronLock('zoho.fulfillment_sync', () =>
      withCronRun('zoho.fulfillment_sync', async () => {
        const perOrg = await forEachOrgWithProvider(
          'zoho',
          (orgId) => syncShippedOrdersToZoho({ since, dryRun: dryRunOverride, limit, orgId }),
          { includeUsavTransitional: true },
        );

        const totals = { scanned: 0, completed: 0, skipped: 0, errored: 0 };
        const errors: string[] = [];
        let dryRunSeen = false;
        let invoiceMode: SyncRunReport['invoiceMode'] | null = null;
        let allLiveErrorFree = true;
        for (const r of perOrg) {
          if (r.ok && r.result) {
            totals.scanned += r.result.scanned;
            totals.completed += r.result.completed;
            totals.skipped += r.result.skipped;
            totals.errored += r.result.errored;
            dryRunSeen = dryRunSeen || r.result.dryRun;
            invoiceMode = r.result.invoiceMode;
            if (r.result.dryRun || r.result.errored > 0) allLiveErrorFree = false;
            if (errors.length < 25) errors.push(...r.result.errors);
          } else {
            totals.errored += 1;
            allLiveErrorFree = false;
            if (errors.length < 25) errors.push(`org ${r.orgId}: ${r.error instanceof Error ? r.error.message : String(r.error)}`);
          }
        }

        // Advance the (shared) cursor only after every org had an error-free LIVE run.
        if (allLiveErrorFree && perOrg.length > 0) {
          await updateSyncCursor(CURSOR_KEY, new Date());
        }
        return {
          ...totals,
          dryRun: dryRunSeen,
          invoiceMode: invoiceMode ?? config.invoiceMode,
          errors: errors.slice(0, 25),
          orgs_swept: perOrg.length,
          orgs_failed: perOrg.filter((r) => !r.ok).length,
        };
      }),
    );

    if (!locked.ran) {
      return NextResponse.json({ ok: true, skipped: 'locked', mode });
    }
    const summary = locked.result!;

    return NextResponse.json({
      ok: summary.errored === 0,
      mode,
      dryRun: summary.dryRun,
      invoiceMode: summary.invoiceMode,
      cursor: { resource: CURSOR_KEY, since: since?.toISOString() ?? null },
      orgs_swept: summary.orgs_swept,
      orgs_failed: summary.orgs_failed,
      totals: {
        scanned: summary.scanned,
        completed: summary.completed,
        skipped: summary.skipped,
        errored: summary.errored,
      },
      errors: summary.errors.slice(0, 25),
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'fulfillment-sync failed';
    console.error('[cron/zoho/fulfillment-sync]', error);
    return NextResponse.json({ ok: false, mode, error: message }, { status: 500 });
  }
}
