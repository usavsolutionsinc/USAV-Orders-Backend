/**
 * POST /api/receiving-lines/incoming/refresh
 *
 * Operator-triggered re-poll of carrier tracking, surfaced on the Incoming
 * receiving view. Re-syncs only the shipments backing the Incoming table —
 * UPS/USPS/FedEx tracking#s attached to still-incoming PO lines, the set the
 * operator actually sees — rather than every active shipment in the system.
 * After the sweep, anything the carrier already delivered flips to DELIVERED so
 * the "Delivered · not scanned" tile/list reflects reality.
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
import { NOT_ZOHO_RECEIVED_PREDICATE } from '@/lib/receiving/delivered-unscanned';
import { getCachedJson, setCachedJson, invalidateCacheTags } from '@/lib/cache/upstash-cache';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const BATCH_CAP = 250;        // hard ceiling on shipments polled per refresh
const COOLDOWN_SECONDS = 25;  // collapse rapid re-clicks across operators

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
    // Scope to EXACTLY the shipments backing the Incoming table — the
    // tracking#s an operator actually sees in the list — not every active
    // shipment in the system. A shipment is in-scope when it's attached to a
    // still-incoming PO line (EXPECTED, nothing received yet, PO not
    // Zoho-received/closed), reached via the identical soft receiving join the
    // row endpoint uses (direct FK, else PO#-based fallback), so the synced set
    // matches the displayed set. Prioritize out-for-delivery + never-polled so a
    // freshly-delivered box flips first.
    const { rows } = await pool.query<{ id: number; carrier: string }>(
      `WITH incoming_shipments AS (
         SELECT DISTINCT ON (stn.id)
                stn.id,
                stn.carrier,
                stn.latest_status_category,
                stn.is_out_for_delivery,
                stn.is_in_transit,
                stn.is_carrier_accepted,
                stn.next_check_at
           FROM receiving_lines rl
           LEFT JOIN zoho_po_mirror mirror
             ON mirror.zoho_purchaseorder_id = rl.zoho_purchaseorder_id
           JOIN LATERAL (
             SELECT r.* FROM receiving r
              WHERE r.id = rl.receiving_id
                 OR (rl.receiving_id IS NULL
                     AND r.source = 'zoho_po'
                     AND r.zoho_purchaseorder_id = rl.zoho_purchaseorder_id)
              ORDER BY (r.id = rl.receiving_id) DESC,
                       (r.shipment_id IS NOT NULL) DESC,
                       r.id DESC
              LIMIT 1
           ) r ON TRUE
           JOIN shipping_tracking_numbers stn ON stn.id = r.shipment_id
          WHERE rl.workflow_status = 'EXPECTED'
            AND COALESCE(rl.quantity_received, 0) = 0
            AND rl.zoho_purchaseorder_id IS NOT NULL
            AND ${NOT_ZOHO_RECEIVED_PREDICATE}
            AND stn.carrier IN ('UPS','USPS','FEDEX')
            AND COALESCE(stn.is_terminal, false) = false
            AND COALESCE(stn.consecutive_error_count, 0) < 5
          ORDER BY stn.id
       )
       SELECT id, carrier
         FROM incoming_shipments
        ORDER BY CASE WHEN is_out_for_delivery THEN 0
                      WHEN latest_status_category IS NULL THEN 1
                      WHEN is_in_transit THEN 2
                      WHEN is_carrier_accepted THEN 3
                      ELSE 4 END,
                 next_check_at ASC NULLS FIRST
        LIMIT ${BATCH_CAP + 1}`,
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
