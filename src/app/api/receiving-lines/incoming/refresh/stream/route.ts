/**
 * POST /api/receiving-lines/incoming/refresh/stream
 *
 * Streaming twin of /api/receiving-lines/incoming/refresh. Re-polls the same
 * active-tracking surface (every non-terminal UPS/USPS/FedEx shipment we can
 * still poll) but emits NDJSON events as each carrier starts and each shipment
 * resolves, so the "Sync carriers" popover can show live per-carrier detail.
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
import { getCachedJson, setCachedJson, invalidateCacheTags } from '@/lib/cache/upstash-cache';
import { createNdjsonStream, ndjsonResponseHeaders } from '@/lib/orders-sync/streaming';
import type { CarrierSyncResult, CarrierSyncStreamEvent } from '@/lib/carrier-sync/types';
import type { CarrierCode, NormalizedShipmentStatus } from '@/lib/shipping/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const BATCH_CAP = 250;        // hard ceiling on shipments polled per refresh
const COOLDOWN_SECONDS = 25;  // collapse rapid re-clicks across operators
const ACTIVE_WINDOW_DAYS = 45; // skip ancient non-terminal rows (dead labels)

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

      // The active tracking surface: every non-terminal shipment we can still
      // poll. NOT limited to PO-joined rows — registered-but-never-polled
      // numbers (latest_status_category IS NULL) are exactly what makes the
      // counts wrong, so prioritize those + about-to-arrive ones.
      const { rows } = await pool.query<{
        id: number;
        carrier: string;
        tracking_number_normalized: string | null;
        latest_status_category: NormalizedShipmentStatus | null;
      }>(
        `SELECT id, carrier, tracking_number_normalized, latest_status_category
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
