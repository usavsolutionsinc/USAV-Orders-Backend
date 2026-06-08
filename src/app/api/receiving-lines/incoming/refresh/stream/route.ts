/**
 * POST /api/receiving-lines/incoming/refresh/stream
 *
 * Streaming twin of /api/receiving-lines/incoming/refresh. Re-polls only the
 * shipments backing the Incoming table (UPS/USPS/FedEx tracking#s attached to
 * still-incoming PO lines — the set the operator actually sees), not every
 * active shipment in the system, and emits NDJSON events as each carrier starts
 * and each shipment resolves so the "Sync carriers" popover can show live
 * per-carrier detail.
 *
 * Shares the non-streaming route's rate limit + cross-operator cooldown so the
 * popover can't be used to bypass carrier rate-limit protection: a click inside
 * the cooldown window streams the cached summary and finishes immediately.
 */

import { NextRequest } from 'next/server';
import pool from '@/lib/db';
import { withAuth } from '@/lib/auth/withAuth';
import { checkRateLimit } from '@/lib/api-guard';
import { syncShipmentsByIdsStreaming } from '@/lib/shipping/scheduler';
import { NOT_ZOHO_RECEIVED_PREDICATE } from '@/lib/receiving/delivered-unscanned';
import { getCachedJson, setCachedJson, invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { createNdjsonStream, ndjsonResponseHeaders } from '@/lib/orders-sync/streaming';
import type { CarrierSyncResult, CarrierSyncStreamEvent } from '@/lib/carrier-sync/types';
import type { CarrierCode, NormalizedShipmentStatus } from '@/lib/shipping/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const BATCH_CAP = 250;        // hard ceiling on shipments polled per refresh
const COOLDOWN_SECONDS = 25;  // collapse rapid re-clicks across operators

export const POST = withAuth(async (req: NextRequest) => {
  const rate = checkRateLimit({
    headers: req.headers,
    routeKey: 'incoming-tracking-refresh',
    limit: 6,
    windowMs: 60_000,
  });
  if (!rate.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'Rate limit exceeded' }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        ...(rate.retryAfterSec ? { 'Retry-After': String(rate.retryAfterSec) } : {}),
      },
    });
  }

  const stream = createNdjsonStream<CarrierSyncStreamEvent>();

  (async () => {
    try {
      // Cross-operator cooldown: if someone just refreshed, stream that result
      // (so the popover still shows "just refreshed") and stop — don't re-hit
      // the carrier APIs.
      const cached = await getCachedJson<CarrierSyncResult>('incoming-refresh', 'last');
      if (cached) {
        stream.emit({ type: 'result', result: { ...cached, throttled: true } });
        return;
      }

      // Scope to EXACTLY the shipments backing the Incoming table — the
      // tracking#s an operator actually sees in the list — not every active
      // shipment in the system. A shipment is in-scope when it's attached to a
      // still-incoming PO line (EXPECTED, nothing received yet, PO not
      // Zoho-received/closed), which is the same surface the row endpoint and
      // tile counts draw from. We reach the shipment via the identical soft
      // receiving join the table uses (direct FK, else PO#-based fallback), so
      // the synced set matches the displayed set. Polling priority is
      // unchanged: out-for-delivery first, then never-polled, then in transit.
      const { rows } = await pool.query<{
        id: number;
        carrier: string;
        tracking_number_normalized: string | null;
        latest_status_category: NormalizedShipmentStatus | null;
      }>(
        `WITH incoming_shipments AS (
           SELECT DISTINCT ON (stn.id)
                  stn.id,
                  stn.carrier,
                  stn.tracking_number_normalized,
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
         SELECT id, carrier, tracking_number_normalized, latest_status_category
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

      const result = await syncShipmentsByIdsStreaming(
        batch.map((r) => ({
          id: r.id,
          carrier: r.carrier,
          tracking: r.tracking_number_normalized,
          previousStatus: r.latest_status_category,
        })),
        {
          concurrency: 5,
          onCarrierStart: (carrier, total) =>
            stream.emit({ type: 'carrier-start', carrier: carrier as CarrierCode, total }),
          onShipment: (o) =>
            stream.emit({
              type: 'detail',
              carrier: o.carrier as CarrierCode,
              row: {
                shipmentId: o.shipmentId,
                tracking: o.tracking ?? '',
                previousStatus: o.previousStatus as NormalizedShipmentStatus | null,
                newStatus: o.newStatus as NormalizedShipmentStatus | null,
                eventsInserted: o.eventsInserted,
                kind: o.kind,
                error: o.error,
              },
            }),
          onCarrierDone: (carrier) =>
            stream.emit({ type: 'carrier-done', carrier: carrier as CarrierCode }),
        },
      );

      // Carrier statuses changed → drop the row/summary caches so the next
      // refetch reflects freshly-delivered packages.
      if (result.terminal > 0 || result.synced > 0) {
        try {
          await invalidateCacheTags(['receiving-lines', 'receiving-logs']);
        } catch { /* non-fatal */ }
      }

      const summary: CarrierSyncResult = {
        scanned: batch.length,
        delivered: result.terminal,
        updated: result.synced,
        errors: result.errors,
        capped,
      };

      await setCachedJson('incoming-refresh', 'last', summary, COOLDOWN_SECONDS);
      stream.emit({ type: 'result', result: summary });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Refresh failed';
      console.error('incoming/refresh/stream failed:', error);
      stream.emit({ type: 'error', error: message });
    } finally {
      stream.finish();
    }
  })();

  return new Response(stream.body, { headers: ndjsonResponseHeaders() });
}, { permission: 'receiving.view' });
