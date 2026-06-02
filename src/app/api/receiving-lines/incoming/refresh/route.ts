/**
 * POST /api/receiving-lines/incoming/refresh
 *
 * Operator-triggered re-poll of carrier tracking, surfaced on the Incoming
 * receiving view. Re-syncs every non-terminal shipment we can still poll — not
 * just PO-joined rows — because the packages that make the counts wrong are
 * mostly shipments that were registered but never successfully polled
 * (latest_status_category IS NULL: a tracking# with no status). After the
 * sweep, anything the carrier already delivered flips to DELIVERED so the
 * "Delivered · not scanned" tile/list reflects reality.
 *
 * Scope keeps us off the carrier rate limits: terminal (delivered/returned),
 * UNKNOWN-carrier, and dead (≥5 consecutive errors) numbers are excluded, and
 * the batch is capped at BATCH_CAP. A short cross-operator cooldown collapses
 * simultaneous clicks to a single poll, on top of the per-client rate limit.
 */

import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { checkRateLimit } from '@/lib/api-guard';
import { syncShipmentsByIds } from '@/lib/shipping/scheduler';
import { getCachedJson, setCachedJson, invalidateCacheTags } from '@/lib/cache/upstash-cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BATCH_CAP = 250;        // hard ceiling on shipments polled per refresh
const COOLDOWN_SECONDS = 25;  // collapse rapid re-clicks across operators
const ACTIVE_WINDOW_DAYS = 45; // skip ancient non-terminal rows (dead labels)

interface RefreshSummary {
  ok: true;
  scanned: number;   // shipments re-polled
  delivered: number; // newly terminal (delivered/returned) this pass
  updated: number;   // non-terminal status refreshed
  errors: number;
  capped: boolean;   // true when more incoming shipments exist than BATCH_CAP
  throttled?: boolean;
}

export const POST = withAuth(async (req: NextRequest) => {
  const rate = checkRateLimit({
    headers: req.headers,
    routeKey: 'incoming-tracking-refresh',
    limit: 6,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    return NextResponse.json(
      { ok: false, error: 'Rate limit exceeded' },
      { status: 429, headers: rate.retryAfterSec ? { 'Retry-After': String(rate.retryAfterSec) } : undefined },
    );
  }

  // Cross-operator cooldown: if someone just refreshed, return that result.
  const cached = await getCachedJson<RefreshSummary>('incoming-refresh', 'last');
  if (cached) {
    return NextResponse.json({ ...cached, throttled: true });
  }

  try {
    // The active tracking surface: every non-terminal shipment we can still
    // poll. This intentionally is NOT limited to PO-joined rows — the packages
    // that make the counts wrong are mostly shipments registered (e.g. by the
    // Zoho-PO sync) but never successfully polled (latest_status_category IS
    // NULL), so they have a tracking# with no status. Prioritize those + the
    // about-to-arrive ones so a freshly-delivered box flips first.
    const { rows } = await pool.query<{ id: number; carrier: string }>(
      `SELECT id, carrier
         FROM shipping_tracking_numbers
        WHERE carrier IN ('UPS','USPS','FEDEX')
          AND COALESCE(is_terminal, false) = false
          AND COALESCE(consecutive_error_count, 0) < 5
          AND COALESCE(latest_event_at, created_at) > NOW() - ($1 || ' days')::interval
        ORDER BY CASE WHEN is_out_for_delivery THEN 0
                      WHEN latest_status_category IS NULL THEN 1
                      WHEN is_in_transit THEN 2
                      WHEN is_carrier_accepted THEN 3
                      ELSE 4 END,
                 next_check_at ASC NULLS FIRST
        LIMIT ${BATCH_CAP + 1}`,
      [String(ACTIVE_WINDOW_DAYS)],
    );

    const capped = rows.length > BATCH_CAP;
    const batch = rows.slice(0, BATCH_CAP);
    const result = await syncShipmentsByIds(batch, { concurrency: 5 });

    // Carrier statuses changed → drop the row/summary caches so the next
    // refetch reflects freshly-delivered packages.
    if (result.terminal > 0 || result.synced > 0) {
      try {
        await invalidateCacheTags(['receiving-lines', 'receiving-logs']);
      } catch { /* non-fatal */ }
    }

    const summary: RefreshSummary = {
      ok: true,
      scanned: batch.length,
      delivered: result.terminal,
      updated: result.synced,
      errors: result.errors,
      capped,
    };

    await setCachedJson('incoming-refresh', 'last', summary, COOLDOWN_SECONDS);
    return NextResponse.json(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Refresh failed';
    console.error('incoming/refresh failed:', error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}, { permission: 'receiving.view' });
