/**
 * GET /api/cron/zoho/incoming-po-sync
 *
 * Vercel-cron-triggered sync of Zoho purchase orders into the
 * `receiving_lines` table. Surfaces issued-but-not-yet-received POs
 * under the "Incoming" pill on the receiving page.
 *
 * Unlike /api/cron/zoho/po-sync (which writes to the audit-only
 * `zoho_po_mirror` table for the email reconciler), this cron is the
 * one that materializes Zoho POs as `workflow_status='EXPECTED'` rows
 * in the operator-facing receiving queue.
 *
 * Behavior:
 *   - Pulls only POs with Zoho status='issued' (vendors have sent it,
 *     warehouse is expected to receive). Draft / billed / cancelled
 *     POs are filtered out by the upstream query.
 *   - Delta sync via `sync_cursors` key 'zoho_purchase_orders'. First
 *     run bootstraps from 14 days back to keep the initial pull bounded.
 *   - Cursor only advances on a clean run (no errors), so a partial
 *     failure replays the same window on the next tick.
 *   - Safe caps: max 25 pages × 2000 items per run so a flood can't
 *     blow the function timeout.
 *
 * Idempotency: handled inside `syncZohoPurchaseOrdersToReceiving` —
 * upserts by (`zoho_purchaseorder_id`, `zoho_line_item_id`); never
 * overwrites `quantity_received` or `workflow_status` on rows the
 * operator has already touched (see zoho-receiving-sync.ts:305-319).
 *
 * Auth: Authorization: Bearer ${CRON_SECRET}. Vercel injects this
 * header automatically when the env var is set in the project.
 */

import { NextRequest, NextResponse } from 'next/server';
import { syncZohoPurchaseOrdersToReceiving, type BulkSyncSummary } from '@/lib/zoho-receiving-sync';
import { invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { withCronRun } from '@/lib/cron/run-log';
import { withCronLock } from '@/lib/cron/lock';
import { forEachOrgWithProvider } from '@/lib/cron/for-each-org';

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

  // Optional overrides for ad-hoc backfills (`?days_back=30&status=open`).
  // Defaults are tuned for steady-state delta polling.
  const daysBackRaw = Number(url.searchParams.get('days_back') ?? '');
  const daysBack = Number.isFinite(daysBackRaw) && daysBackRaw >= 0 ? daysBackRaw : 0;
  const statusOverride = (url.searchParams.get('status') || '').trim();
  const maxPagesRaw = Number(url.searchParams.get('max_pages') ?? '');
  const maxItemsRaw = Number(url.searchParams.get('max_items') ?? '');

  try {
    // Cutover policy: only import Zoho POs authored on or after 2026-05-08.
    // Override via `?po_date_floor=YYYY-MM-DD` when backfilling historical
    // windows or `?po_date_floor=` (empty) for an unrestricted pull.
    const poDateFloorParam = (url.searchParams.get('po_date_floor') ?? '').trim();
    const poDateFloor =
      poDateFloorParam === ''
        ? '2026-05-08'
        : /^\d{4}-\d{2}-\d{2}$/.test(poDateFloorParam)
          ? poDateFloorParam
          : '2026-05-08';

    // Distributed lock so an overlapping tick / manual trigger / Vercel retry
    // can't double-sweep. Fan out per Zoho-connected org (plus USAV while it
    // still uses env creds) — each org syncs under its own Zoho credentials and
    // tenant GUC (syncZohoPurchaseOrdersToReceiving self-binds withZohoOrg +
    // withTenantTransaction per PO), with per-org failures isolated.
    const locked = await withCronLock('zoho.incoming_po_sync', () =>
      withCronRun('zoho.incoming_po_sync', async () => {
        const perOrg = await forEachOrgWithProvider(
          'zoho',
          (orgId) =>
            syncZohoPurchaseOrdersToReceiving(orgId, {
              // 'issued' = vendor has sent the PO; warehouse is expected to
              // receive. Use ?status=open or ?status= (empty) for backfills.
              status: statusOverride || 'issued',
              days_back: daysBack,
              per_page: 200,
              max_pages: Number.isFinite(maxPagesRaw) && maxPagesRaw > 0 ? maxPagesRaw : 25,
              max_items: Number.isFinite(maxItemsRaw) && maxItemsRaw > 0 ? maxItemsRaw : 2000,
              po_date_floor: poDateFloor,
            }),
          { includeUsavTransitional: true },
        );

        // Aggregate per-org summaries into the shape callers already expect.
        const totals = {
          processed: 0, created: 0, updated: 0, linked: 0,
          line_items_synced: 0, skipped_pre_floor: 0, failed: 0,
        };
        const errors: BulkSyncSummary['errors'] = [];
        for (const r of perOrg) {
          if (r.ok && r.result) {
            totals.processed += r.result.processed;
            totals.created += r.result.created;
            totals.updated += r.result.updated;
            totals.linked += r.result.linked;
            totals.line_items_synced += r.result.line_items_synced;
            totals.skipped_pre_floor += r.result.skipped_pre_floor;
            totals.failed += r.result.failed;
            if (errors.length < 25) errors.push(...r.result.errors);
          } else {
            // Whole-org failure (e.g. Zoho unreachable) — count it so ok=false.
            totals.failed += 1;
            if (errors.length < 25) {
              errors.push({
                purchaseorder_id: `org:${r.orgId}`,
                error: r.error instanceof Error ? r.error.message : String(r.error),
              });
            }
          }
        }
        return {
          ...totals,
          errors: errors.slice(0, 25),
          orgs_swept: perOrg.length,
          orgs_failed: perOrg.filter((r) => !r.ok).length,
        };
      }),
    );

    const elapsedMs = Date.now() - startedAt;

    // Another invocation held the lock — report the skip, don't fail.
    if (!locked.ran) {
      return NextResponse.json({ ok: true, skipped: 'locked', po_date_floor: poDateFloor, elapsedMs });
    }
    const summary = locked.result!;

    // The sync writes rows operators see in the rail; invalidate the same
    // cache tags `scan-serial` uses so the Incoming pill reflects fresh
    // upserts on the next refetch without waiting for staleTime to expire.
    if (summary.created > 0 || summary.updated > 0) {
      try {
        await invalidateCacheTags(['receiving-lines', 'receiving-logs']);
      } catch (err) {
        console.warn('incoming-po-sync: cache invalidate failed (non-fatal)', err);
      }
    }

    // Single structured log line — Vercel/Datadog log scrapers key off this
    // prefix to plot run cadence + failure rate. Keep field names stable.
    console.log('[cron.incoming-po-sync]', {
      ok: summary.failed === 0,
      po_date_floor: poDateFloor,
      orgs_swept: summary.orgs_swept,
      orgs_failed: summary.orgs_failed,
      processed: summary.processed,
      created: summary.created,
      updated: summary.updated,
      linked: summary.linked,
      line_items_synced: summary.line_items_synced,
      skipped_pre_floor: summary.skipped_pre_floor,
      failed: summary.failed,
      first_errors: summary.errors.slice(0, 3),
      elapsedMs,
    });

    return NextResponse.json({
      ok: summary.failed === 0,
      po_date_floor: poDateFloor,
      orgs_swept: summary.orgs_swept,
      orgs_failed: summary.orgs_failed,
      totals: {
        processed: summary.processed,
        created: summary.created,
        updated: summary.updated,
        linked: summary.linked,
        line_items_synced: summary.line_items_synced,
        skipped_pre_floor: summary.skipped_pre_floor,
        failed: summary.failed,
      },
      errors: summary.errors.slice(0, 25),
      elapsedMs,
    });
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : 'sync threw';
    console.error('[cron.incoming-po-sync] fatal', { message, elapsedMs });
    return NextResponse.json(
      { ok: false, error: message, elapsedMs },
      { status: 500 },
    );
  }
}
